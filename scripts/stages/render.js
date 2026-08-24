// scripts/stages/render.js
const fs = require('fs');
const { execSync } = require('child_process');
const axios = require('axios');

async function withRetry(fn, maxRetries = 5, baseDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e.response?.status === 429 || e.status === 429;
      const isServerError = e.response?.status >= 500 || e.status >= 500;
      
      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        const resetAfter = e.response?.headers?.['x-ratelimit-reset'] 
          ? parseInt(e.response.headers['x-ratelimit-reset']) * 1000 - Date.now()
          : null;
        
        const delay = resetAfter && resetAfter > 0 
          ? Math.min(resetAfter + 1000, 30000)
          : baseDelay * Math.pow(2, attempt - 1) + Math.random() * 2000;
        
        const cappedDelay = Math.min(delay, 30000);
        console.warn(`Attempt ${attempt} failed (${e.response?.status || e.status || e.message}), retrying in ${Math.round(cappedDelay)}ms...`);
        await new Promise(r => setTimeout(r, cappedDelay));
        continue;
      }
      throw e;
    }
  }
}

const VISION_PROVIDERS = [
  {
    name: 'openrouter',
    call: async (messages, model) => {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/sham435/wrangler_video_musicspark0001',
          'X-Title': 'VideoMusicSpark',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || 'google/gemma-4-31b-it:free',
          messages: messages,
          temperature: 0.3,
          max_tokens: 200,
          response_format: { type: 'json_object' }
        })
      });
      
      if (!response.ok) {
        const err = new Error(`OpenRouter ${response.status}`);
        err.status = response.status;
        throw err;
      }
      return response.json();
    },
    models: [
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'deepseek/deepseek-v4-flash',
      'qwen/qwen-2.5-72b-instruct:free',
      'meta-llama/llama-3.2-90b-vision-instruct:free'
    ]
  },
  {
    name: 'openai',
    call: async (messages, model) => {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: model || 'gpt-4o-mini',
        messages: messages,
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      }, { 
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, 
        timeout: 60000 
      });
      return response.data;
    },
    models: ['gpt-4o-mini']
  }
];

async function callVisionLLM(messages) {
  for (const provider of VISION_PROVIDERS) {
    for (const model of provider.models) {
      const label = `${provider.name}/${model}`;
      console.log(`[Vision] Trying ${label}...`);
      
      try {
        const result = await withRetry(() => provider.call(messages, model));
        const content = result.choices?.[0]?.message?.content;
        
        if (content) {
          console.log(`[Vision] Success with ${label}`);
          return JSON.parse(content);
        }
      } catch (error) {
        console.warn(`[Vision] ${label} failed:`, error.message);
        continue;
      }
    }
  }
  throw new Error('All vision LLM providers exhausted');
}

async function renderVideo(scenes) {
  const inputs = scenes.map((_, i) => `-loop 1 -t ${scenes[i].end_time - scenes[i].start_time} -i scene_${i+1}.png`).join(' ');
  const filterParts = scenes.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${i}]`).join(';');
  const concatPart = scenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${scenes.length}:v=1:a=0[outv]`;
  
  let assContent = `[Script Info]
Title: Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Impact,72,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,50,50,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  
  scenes.forEach(s => {
    const start = formatTime(s.start_time);
    const end = formatTime(s.end_time);
    const text = s.lyric_segment.replace(/\n/g, '\\N');
    assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
  });
  
  fs.writeFileSync('subtitles.ass', assContent);

  execSync(`
    ffmpeg -y ${inputs} -i output_audio.mp3 \
      -filter_complex "${filterParts};${concatPart}" \
      -map "[outv]" -map 0:a \
      -vf "subtitles=subtitles.ass" \
      -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
      -c:a aac -b:a 128k -r 30 -shortest \
      final_unsigned.mp4
  `);
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const cs = Math.floor((sec % 1) * 100).toString().padStart(2, '0');
  return `${h}:${m}:${s}.${cs}`;
}

async function generateThumbnails() {
  for (const pct of [0.25, 0.5, 0.75]) {
    const time = pct * 30;
    execSync(`ffmpeg -y -ss ${time} -i final_unsigned.mp4 -vframes 1 -q:v 2 thumb_${pct}.jpg`);
  }
}

async function judgeThumbnails() {
  const thumbs = ['thumb_0.25.jpg', 'thumb_0.5.jpg', 'thumb_0.75.jpg'];
  const scores = {};

  for (const thumb of thumbs) {
    if (!fs.existsSync(thumb)) continue;
    const b64 = fs.readFileSync(thumb, { encoding: 'base64' });
    
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'Rate this YouTube Shorts thumbnail 1-10 on: text legibility, focal clarity, color contrast, platform safety compliance. Output ONLY JSON: {"score": N, "reason": "..."}' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }
      ]
    }];
    
    const result = await callVisionLLM(messages);
    scores[thumb] = result.score;
    
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
  }
  return scores;
}

async function selectThumbnail(scores) {
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best) {
    fs.copyFileSync(best[0], 'final_thumbnail.jpg');
  }
}

module.exports = { renderVideo, generateThumbnails, judgeThumbnails, selectThumbnail, withRetry };