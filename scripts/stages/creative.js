// scripts/stages/creative.js
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
        console.warn(`[${providerName}] Attempt ${attempt} failed (${e.response?.status || e.status || e.message}), retrying in ${Math.round(cappedDelay)}ms...`);
        await new Promise(r => setTimeout(r, cappedDelay));
        continue;
      }
      throw e;
    }
  }
}

let providerName = '';

const LLM_PROVIDERS = [
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
          temperature: 0.7,
          max_tokens: 2000,
          response_format: { type: 'json_object' }
        })
      });
      
      if (!response.ok) {
        const err = new Error(`OpenRouter ${response.status}`);
        err.status = response.status;
        err.response = { status: response.status, headers: Object.fromEntries(response.headers) };
        throw err;
      }
      return response.json();
    },
    models: [
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'deepseek/deepseek-v4-flash',
      'tencent/hy3-preview',
      'qwen/qwen-2.5-72b-instruct:free',
      'meta-llama/llama-3.3-70b-instruct:free'
    ]
  },
  {
    name: 'opencode-zen',
    call: async (messages, model) => {
      const zenUrl = process.env.OPENCODE_ZEN_URL || 'https://opencode-zen-proxy.autonomous-shorts-factory.workers.dev';
      const response = await fetch(`${zenUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'qwen2.5:7b',
          messages: messages
        })
      });
      
      if (!response.ok) {
        const err = new Error(`OpenCode Zen ${response.status}`);
        err.status = response.status;
        throw err;
      }
      return response.json();
    },
    models: ['qwen2.5:7b', 'llama3.2:3b', 'phi3:mini']
  },
  {
    name: 'openai',
    call: async (messages, model) => {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: model || 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
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

async function callLLM(messages, preferredModel = null) {
  for (const provider of LLM_PROVIDERS) {
    const modelsToTry = preferredModel ? [preferredModel, ...provider.models.filter(m => m !== preferredModel)] : provider.models;
    
    for (const model of modelsToTry) {
      providerName = `${provider.name}/${model}`;
      console.log(`[LLM] Trying ${providerName}...`);
      
      try {
        const result = await withRetry(() => provider.call(messages, model));
        
        let content;
        if (provider.name === 'openrouter' || provider.name === 'openai') {
          content = result.choices?.[0]?.message?.content;
        } else if (provider.name === 'opencode-zen') {
          content = result.message?.content || result.choices?.[0]?.message?.content || result.content;
        }
        
        if (content) {
          console.log(`[LLM] Success with ${providerName}`);
          return JSON.parse(content);
        }
      } catch (error) {
        console.warn(`[LLM] ${providerName} failed:`, error.message);
        continue;
      }
    }
  }
  throw new Error('All LLM providers exhausted');
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

  const messages = [{ role: 'user', content: prompt }];
  return callLLM(messages);
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

  await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

  const messages = [{ role: 'user', content: prompt }];
  const data = await callLLM(messages);
  return data.scenes || data;
}

module.exports = { generateStoryboard, planScenes };