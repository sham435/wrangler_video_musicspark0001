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

  try {
    switch (stage) {
      case 'SCHEDULED':
        await callback('SCHEDULED');
        break;

      case 'DISCOVER': {
        const { trends, sourceContext } = await generate();
        fs.writeFileSync('trends.json', JSON.stringify(trends));
        fs.writeFileSync('source_context.txt', sourceContext);
        await callback('DISCOVER', { trends });
        break;
      }

      case 'CREATIVE': {
        const trends = JSON.parse(fs.readFileSync('trends.json', 'utf8'));
        const storyboard = await generateStoryboard(trends);
        fs.writeFileSync('storyboard.json', JSON.stringify(storyboard));
        
        const scenes = await planScenes(storyboard);
        fs.writeFileSync('scenes.json', JSON.stringify(scenes));
        await callback('CREATIVE', { storyboard, scenes });
        break;
      }

      case 'GENERATE': {
        const scenes = JSON.parse(fs.readFileSync('scenes.json', 'utf8'));
        await generateVisuals(scenes);
        await generateAudio(scenes);
        await callback('GENERATE');
        break;
      }

      case 'RENDER': {
        const scenes = JSON.parse(fs.readFileSync('scenes.json', 'utf8'));
        await renderVideo(scenes);
        await generateThumbnails();
        const scores = await judgeThumbnails();
        await selectThumbnail(scores);
        await callback('RENDER');
        break;
      }

      case 'SIGN': {
        await preflightCheck();
        await signC2PA();
        await verifyC2PA();
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
        await callback('PUBLISH', { videoId });
        break;
      }

      case 'LEARN': {
        const { videoId } = JSON.parse(fs.readFileSync('publish_result.json', 'utf8'));
        await syncGitHub();
        await collectAnalytics(videoId);
        await updateMemory();
        await learn();
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