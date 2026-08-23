// scripts/stages/visuals.js
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

async function generateVisuals(scenes) {
  const providers = [
    { name: 'pollinations', url: 'https://image.pollinations.ai/prompt/' },
    { name: 'huggingface', url: 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0' }
  ];

  for (const scene of scenes) {
    let success = false;
    
    for (const provider of providers) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          let imageBuffer;
          
          if (provider.name === 'pollinations') {
            const prompt = encodeURIComponent(`${scene.visual_prompt}, 1080x1920, vertical, 4k`);
            const res = await axios.get(`${provider.url}${prompt}`, { 
              responseType: 'arraybuffer',
              timeout: 30000
            });
            imageBuffer = Buffer.from(res.data);
          } else {
            const res = await axios.post(provider.url, {
              inputs: `${scene.visual_prompt}, 1080x1920, vertical, 4k`,
              parameters: { width: 1080, height: 1920, num_inference_steps: 25 }
            }, {
              headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` },
              responseType: 'arraybuffer',
              timeout: 60000
            });
            imageBuffer = Buffer.from(res.data);
          }

          // Validate: not black/corrupt
          const check = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 -i -`, {
            input: imageBuffer,
            encoding: 'buffer'
          });
          const [w, h] = check.toString().trim().split(',').map(Number);
          if (w === 1080 && h === 1920) {
            fs.writeFileSync(`scene_${scene.scene_id}.png`, imageBuffer);
            success = true;
            break;
          }
        } catch (e) {
          console.warn(`[${provider.name}] Attempt ${attempt} failed for scene ${scene.scene_id}:`, e.message);
        }
      }
      if (success) break;
    }

    if (!success) throw new Error(`All providers exhausted for scene ${scene.scene_id}`);
  }
}

module.exports = { generateVisuals };