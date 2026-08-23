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

async function generate() {
  const trends = { themes: [], bpmRange: [120, 140], tone: 'energetic' };

  // 1. YouTube Data API v3 (10k units/day free)
  try {
    const ytRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
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
    trends.themes.push(...ytRes.data.items.map(i => i.snippet.title).slice(0, 5));
  } catch (e) { console.warn('YouTube Trends failed:', e.message); }

  // 2. Hacker News (no auth, reliable)
  try {
    const hnRes = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 5000 });
    const topIds = hnRes.data.slice(0, 10);
    for (const id of topIds) {
      try {
        const item = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 3000 });
        if (item.data?.title) trends.themes.push(item.data.title);
      } catch (itemErr) {
        console.warn(`HN item ${id} failed:`, itemErr.message);
      }
    }
  } catch (e) { console.warn('HN failed:', e.message); }

  // 3. Reddit JSON (no auth)
  try {
    const rdRes = await axios.get('https://www.reddit.com/r/technology/hot.json?limit=10', {
      headers: { 'User-Agent': 'AutonomousShortsBot/1.0' },
      timeout: 10000
    });
    trends.themes.push(...rdRes.data.data.children.map(c => c.data.title).slice(0, 5));
  } catch (e) { console.warn('Reddit failed:', e.message); }

  // Fallback: if all sources failed, use defaults
  if (trends.themes.length === 0) {
    console.warn('All trend sources failed, using fallback themes');
    trends.themes = FALLBACK_THEMES;
  }

  const sourceContext = trends.themes.slice(0, 10).join('\n---\n');
  return { trends, sourceContext };
}

module.exports = { generate };