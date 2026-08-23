// scripts/stages/creative.js
const axios = require('axios');

async function withRetry(fn, maxRetries = 5, baseDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e.response?.status === 429;
      const isServerError = e.response?.status >= 500;
      
      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 2000;
        console.warn(`Attempt ${attempt} failed (${e.response?.status || e.message}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
}

async function generateStoryboard(trends) {
  const prompt = `Create a 30-60 second vertical music short storyboard.
Trending themes: ${trends.themes.join(', ')}
BPM range: ${trends.bpmRange.join('-')}
Tone: ${trends.tone}

Output ONLY valid JSON:
{
  "overall_theme": "string",
  "target_duration": number (15-60),
  "vibe_description": "string"
}`;

  const res = await withRetry(() => axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    response_format: { type: 'json_object' }
  }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 60000 }));

  return JSON.parse(res.data.choices[0].message.content);
}

async function planScenes(storyboard) {
  const duration = storyboard.target_duration;
  const sceneCount = Math.max(3, Math.ceil(duration / 3));
  const sceneDuration = duration / sceneCount;

  const prompt = `Break this storyboard into ${sceneCount} scenes of ${sceneDuration.toFixed(1)}s each.
Storyboard: ${JSON.stringify(storyboard)}

Output ONLY valid JSON array:
[
  {"scene_id": 1, "start_time": 0, "end_time": ${sceneDuration}, "visual_prompt": "...", "lyric_segment": "...", "audio_instruction": "..."}
]`;

  // Small delay between API calls to avoid rate limit
  await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

  const res = await withRetry(() => axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    response_format: { type: 'json_object' }
  }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 60000 }));

  const data = JSON.parse(res.data.choices[0].message.content);
  return data.scenes || data;
}

module.exports = { generateStoryboard, planScenes };