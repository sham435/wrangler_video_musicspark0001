// scripts/stages/discover.js
const axios = require('axios');

const FALLBACK_THEMES = [
  'AI music generation trends',
  'Cyberpunk aesthetic visuals',
  'Lo-fi beats for studying',
  'Synthwave retro vibes',
  'Ambient electronic soundscapes',
  'Music production tips',
  'Digital art and animation',
  'Technology and creativity'
];

async function safeGet(url, options = {}) {
  try {
    const res = await axios.get(url, { 
      timeout: options.timeout || 5000,
      validateStatus: () => true,
      ...options
    });
    return { success: res.status === 200, data: res.data, status: res.status };
  } catch (e) {
    console.warn(`safeGet error for ${url}:`, e.message);
    return { success: false, error: e.message };
  }
}

async function generate() {
  try {
    const trends = { themes: [], bpmRange: [120, 140], tone: 'energetic' };

    // 1. YouTube Data API v3 (10k units/day free)
    const yt = await safeGet('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        chart: 'mostPopular',
        regionCode: 'US',
        videoCategoryId: '10',
        maxResults: 20,
        key: process.env.YOUTUBE_API_KEY
      },
      timeout: 10000
    });
    if (yt.success) {
      trends.themes.push(...yt.data.items.map(i => i.snippet.title).slice(0, 5));
    } else {
      console.warn('YouTube Trends failed:', yt.error || `status ${yt.status}`);
    }

    // 2. Hacker News (no auth, reliable)
    const hnTop = await safeGet('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 5000 });
    if (hnTop.success) {
      const topIds = hnTop.data.slice(0, 10);
      for (const id of topIds) {
        const item = await safeGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 3000 });
        if (item.success && item.data?.title) {
          trends.themes.push(item.data.title);
        }
      }
    } else {
      console.warn('HN topstories failed:', hnTop.error || `status ${hnTop.status}`);
    }

    // 3. Reddit JSON (no auth)
    const rd = await safeGet('https://www.reddit.com/r/technology/hot.json?limit=10', {
      headers: { 'User-Agent': 'AutonomousShortsBot/1.0' },
      timeout: 10000
    });
    if (rd.success) {
      trends.themes.push(...rd.data.data.children.map(c => c.data.title).slice(0, 5));
    } else {
      console.warn('Reddit failed:', rd.error || `status ${rd.status}`);
    }

    // Fallback: if all sources failed, use defaults
    if (trends.themes.length === 0) {
      console.warn('All trend sources failed, using fallback themes');
      trends.themes = FALLBACK_THEMES;
    }

    const sourceContext = trends.themes.slice(0, 10).join('\n---\n');
    console.log(`DISCOVER complete: ${trends.themes.length} themes collected`);
    return { trends, sourceContext };
  } catch (e) {
    console.error('DISCOVER unexpected error:', e.message, e.stack);
    // Even on unexpected error, return fallback
    return { 
      trends: { themes: FALLBACK_THEMES, bpmRange: [120, 140], tone: 'energetic' },
      sourceContext: FALLBACK_THEMES.join('\n---\n')
    };
  }
}

module.exports = { generate };