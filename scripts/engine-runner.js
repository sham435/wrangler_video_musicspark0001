// scripts/engine-runner.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { generate } = require('./stages/discover');
const { generateStoryboard, planScenes } = require('./stages/creative');
const { generateVisuals } = require('./stages/visuals');
const { generateAudio } = require('./stages/audio');
const { renderVideo, generateThumbnails, judgeThumbnails, selectThumbnail } = require('./stages/render');
const { preflightCheck } = require('./stages/preflight');
const { signC2PA, verifyC2PA } = require('./stages/c2pa');
const { uploadVideo, waitProcessing, setThumbnail, verifyThumbnail, setMetadata, publishVideo, verifyPublication } = require('./stages/publish');
const { syncGitHub, collectAnalytics, updateMemory, learn } = require('./stages/learn');

const uuid = process.env.PRODUCTION_UUID;
const stage = process.env.TARGET_STAGE;
const WORKER_URL = process.env.CLOUDFLARE_WORKER_URL;
const WORK_DIR = `/tmp/${uuid}`;

// Artifact definitions per stage
const ARTIFACTS = {
  DISCOVER: ['trends.json', 'source_context.txt'],
  CREATIVE: ['storyboard.json', 'scenes.json'],
  GENERATE: ['scenes.json', 'scene_*.png', 'output_audio.mp3', 'vocals.wav', 'instrumental.wav'],
  RENDER: ['final_unsigned.mp4', 'final_thumbnail.jpg', 'scenes.json'],
  SIGN: ['final_unsigned.mp4'],  // signed in place
  PUBLISH: ['publish_result.json'],
  LEARN: ['active_generation_weights.json']
};

async function downloadArtifacts() {
  try {
    console.log(`[${uuid}] Downloading artifacts for ${stage}...`);
    const res = await axios.get(`${WORKER_URL}/artifacts/${uuid}`, { timeout: 30000 });
    if (res.data && res.data.files) {
      for (const [filename, content] of Object.entries(res.data.files)) {
        fs.writeFileSync(path.join(WORK_DIR, filename), content, 'base64');
      }
      console.log(`[${uuid}] Downloaded ${Object.keys(res.data.files).length} artifacts`);
    }
  } catch (e) {
    console.warn(`[${uuid}] Artifact download failed (may be first stage):`, e.message);
  }
}

async function uploadArtifacts() {
  try {
    const patterns = ARTIFACTS[stage] || [];
    const files = {};
    
    for (const pattern of patterns) {
      // Handle glob patterns
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        const matched = fs.readdirSync(WORK_DIR).filter(f => regex.test(f));
        for (const f of matched) {
          const content = fs.readFileSync(path.join(WORK_DIR, f));
          files[f] = content.toString('base64');
        }
      } else {
        const filepath = path.join(WORK_DIR, pattern);
        if (fs.existsSync(filepath)) {
          const content = fs.readFileSync(filepath);
          files[pattern] = content.toString('base64');
        }
      }
    }
    
    if (Object.keys(files).length > 0) {
      console.log(`[${uuid}] Uploading ${Object.keys(files).length} artifacts...`);
      await axios.post(`${WORKER_URL}/artifacts/${uuid}`, { files }, { timeout: 60000 });
      console.log(`[${uuid}] Artifacts uploaded`);
    }
  } catch (e) {
    console.warn(`[${uuid}] Artifact upload failed:`, e.message);
  }
}

async function callback(completedStage, data = {}) {
  await axios.post(`${WORKER_URL}/webhook/callback`, {
    production_uuid: uuid,
    completed_stage: completedStage,
    data: { ...data, last_executed: new Date().toISOString() }
  });
}

async function runEngine() {
  console.log(`[${uuid}] Starting stage: ${stage}`);
  fs.mkdirSync(WORK_DIR, { recursive: true });
  process.chdir(WORK_DIR);

  // Download artifacts from previous stages
  if (stage !== 'SCHEDULED' && stage !== 'DISCOVER') {
    await downloadArtifacts();
  }

  try {
    switch (stage) {
      case 'SCHEDULED':
        await callback('SCHEDULED');
        break;

      case 'DISCOVER': {
        const { trends, sourceContext } = await generate();
        fs.writeFileSync('trends.json', JSON.stringify(trends));
        fs.writeFileSync('source_context.txt', sourceContext);
        await uploadArtifacts();
        await callback('DISCOVER', { trends });
        break;
      }

      case 'CREATIVE': {
        const trends = JSON.parse(fs.readFileSync('trends.json', 'utf8'));
        const storyboard = await generateStoryboard(trends);
        fs.writeFileSync('storyboard.json', JSON.stringify(storyboard));
        
        const scenes = await planScenes(storyboard);
        fs.writeFileSync('scenes.json', JSON.stringify(scenes));
        await uploadArtifacts();
        await callback('CREATIVE', { storyboard, scenes });
        break;
      }

      case 'GENERATE': {
        const scenes = JSON.parse(fs.readFileSync('scenes.json', 'utf8'));
        await generateVisuals(scenes);
        await generateAudio(scenes);
        await uploadArtifacts();
        await callback('GENERATE');
        break;
      }

      case 'RENDER': {
        const scenes = JSON.parse(fs.readFileSync('scenes.json', 'utf8'));
        await renderVideo(scenes);
        await generateThumbnails();
        const scores = await judgeThumbnails();
        await selectThumbnail(scores);
        await uploadArtifacts();
        await callback('RENDER');
        break;
      }

      case 'SIGN': {
        await preflightCheck();
        await signC2PA();
        await verifyC2PA();
        await uploadArtifacts();
        await callback('SIGN');
        break;
      }

      case 'PUBLISH': {
        const videoId = await uploadVideo();
        await waitProcessing(videoId);
        await setThumbnail(videoId);
        await verifyThumbnail(videoId);
        await setMetadata(videoId);
        await publishVideo(videoId);
        await verifyPublication(videoId);
        fs.writeFileSync('publish_result.json', JSON.stringify({ videoId }));
        await uploadArtifacts();
        await callback('PUBLISH', { videoId });
        break;
      }

      case 'LEARN': {
        const { videoId } = JSON.parse(fs.readFileSync('publish_result.json', 'utf8'));
        await syncGitHub();
        await collectAnalytics(videoId);
        await updateMemory();
        await learn();
        await uploadArtifacts();
        console.log(`[${uuid}] Production complete.`);
        break;
      }
    }
  } catch (err) {
    console.error(`[${uuid}] CRITICAL FAILURE in ${stage}:`, err.message);
    process.exit(1);
  }
}

runEngine();