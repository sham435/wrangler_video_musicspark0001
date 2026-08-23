// scripts/stages/preflight.js
const { execSync } = require('child_process');
const fs = require('fs');

async function preflightCheck() {
  const file = 'final_unsigned.mp4';
  if (!fs.existsSync(file)) throw new Error('Video file missing');
  
  const stats = fs.statSync(file);
  if (stats.size === 0) throw new Error('Video file is 0 bytes');

  const probe = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of json ${file}`);
  const { streams } = JSON.parse(probe);
  const v = streams[0];
  
  if (v.width !== 1080 || v.height !== 1920) {
    throw new Error(`Invalid dimensions: ${v.width}x${v.height}, expected 1080x1920`);
  }
  
  const [num, den] = v.r_frame_rate.split('/').map(Number);
  const fps = num / den;
  if (fps !== 30 && fps !== 60) {
    throw new Error(`Invalid frame rate: ${fps}, expected 30 or 60`);
  }

  // Audio loudness check (EBU R128)
  const loudness = execSync(`ffmpeg -i ${file} -af ebur128 -f null - 2>&1 | grep "I:" | tail -1`);
  const integrated = parseFloat(loudness.toString().match(/I:\s*(-?\d+\.?\d*)/)?.[1] || '-99');
  
  if (integrated > -12 || integrated < -16) {
    console.warn(`Loudness ${integrated} LUFS outside target -14±2, applying loudnorm`);
    execSync(`ffmpeg -y -i ${file} -af loudnorm=I=-14:TP=-1:LRA=11 -c:v copy ${file}.fixed.mp4`);
    fs.renameSync(`${file}.fixed.mp4`, file);
  }

  console.log('Preflight passed');
}

module.exports = { preflightCheck };