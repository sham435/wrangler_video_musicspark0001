// scripts/stages/visuals.js
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

async function withRetry(fn, maxRetries = 3, baseDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isNetworkError = e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT';
      const isRateLimit = e.response?.status === 429 || e.status === 429;
      const isServerError = e.response?.status >= 500 || e.status >= 500;
      
      if ((isNetworkError || isRateLimit || isServerError) && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        const cappedDelay = Math.min(delay, 15000);
        console.warn(`Attempt ${attempt} failed (${e.code || e.response?.status || e.status || e.message}), retrying in ${Math.round(cappedDelay)}ms...`);
        await new Promise(r => setTimeout(r, cappedDelay));
        continue;
      }
      throw e;
    }
  }
}

async function generateVisuals(scenes) {
  // Use Pollinations as primary (no auth, reliable), with local fallback
  const providers = [
    { 
      name: 'pollinations', 
      generate: async (prompt) => {
        const encodedPrompt = encodeURIComponent(`${prompt}, 1080x1920, vertical, 4k, high quality`);
        // Original working Pollinations endpoint
        const res = await axios.get(`https://image.pollinations.ai/prompt/${encodedPrompt}`, { 
          responseType: 'arraybuffer',
          timeout: 60000
        });
        // Validate response is actually an image (not HTML error page)
        const contentType = res.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) {
          throw new Error(`Invalid content-type: ${contentType}`);
        }
        return Buffer.from(res.data);
      }
    },
    { 
      name: 'pollinations-alt', 
      generate: async (prompt) => {
        // Alternative: direct image URL with parameters
        const encodedPrompt = encodeURIComponent(`${prompt}, 1080x1920, vertical, 4k`);
        const res = await axios.get(`https://image.pollinations.ai/prompt/${encodedPrompt}?width=1080&height=1920&model=flux`, { 
          responseType: 'arraybuffer',
          timeout: 60000
        });
        const contentType = res.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) {
          throw new Error(`Invalid content-type: ${contentType}`);
        }
        return Buffer.from(res.data);
      }
    }
  ];

  for (const scene of scenes) {
    let success = false;
    
    for (const provider of providers) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const imageBuffer = await withRetry(() => provider.generate(scene.visual_prompt));
          
          // Validate: not black/corrupt, correct dimensions
          const check = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 -i -`, {
            input: imageBuffer,
            encoding: 'buffer',
            timeout: 10000
          });
          const [w, h] = check.toString().trim().split(',').map(Number);
          if (w === 1080 && h === 1920) {
            fs.writeFileSync(`scene_${scene.scene_id}.png`, imageBuffer);
            console.log(`[Visuals] Scene ${scene.scene_id} generated via ${provider.name}`);
            success = true;
            break;
          } else {
            console.warn(`[${provider.name}] Invalid dimensions: ${w}x${h}`);
          }
        } catch (e) {
          console.warn(`[${provider.name}] Attempt ${attempt} failed for scene ${scene.scene_id}:`, e.message);
        }
      }
      if (success) break;
    }

    // Last resort: generate solid color placeholder with text
    if (!success) {
      console.warn(`[Visuals] All providers failed for scene ${scene.scene_id}, generating placeholder`);
      const placeholderPrompt = `A vertical 1080x1920 gradient background with text "${scene.visual_prompt.substring(0, 50)}", cinematic lighting`;
      try {
        const encodedPrompt = encodeURIComponent(`${placeholderPrompt}, 1080x1920, vertical`);
        const res = await axios.get(`https://image.pollinations.ai/prompt/${encodedPrompt}?width=1080&height=1920`, { 
          responseType: 'arraybuffer',
          timeout: 60000
        });
        const contentType = res.headers['content-type'];
        if (contentType && contentType.startsWith('image/')) {
          fs.writeFileSync(`scene_${scene.scene_id}.png`, Buffer.from(res.data));
          console.log(`[Visuals] Scene ${scene.scene_id} generated placeholder`);
          success = true;
        }
      } catch (e) {
        console.warn(`[Visuals] Placeholder failed:`, e.message);
      }
      
      if (!success) {
        // Ultimate fallback: create solid color with ffmpeg
        execSync(`ffmpeg -y -f lavfi -i color=c=0x1a1a2e:size=1080x1920:duration=1 -vframes 1 scene_${scene.scene_id}.png`);
        console.log(`[Visuals] Scene ${scene.scene_id} generated solid color fallback`);
      }
    }
  }
}

module.exports = { generateVisuals };