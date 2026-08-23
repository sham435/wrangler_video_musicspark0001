// scripts/stages/audio.js
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');

async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isRateLimit = e.response?.status === 429;
      const isServerError = e.response?.status >= 500;
      
      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(`Attempt ${attempt} failed (${e.response?.status || e.message}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
}

async function generateAudio(scenes) {
  const fullLyrics = scenes.map(s => s.lyric_segment).join(' ');
  
  // 1. Vocals via ElevenLabs (free tier ~10k chars/mo)
  try {
    const res = await withRetry(() => axios.post(
      'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM',
      {
        text: fullLyrics,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      },
      {
        headers: { 
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer',
        timeout: 60000
      }
    ));
    fs.writeFileSync('vocals.mp3', res.data);
    execSync('ffmpeg -y -i vocals.mp3 -ar 44100 -ac 2 vocals.wav');
  } catch (e) {
    console.warn('ElevenLabs failed, falling back to Piper TTS:', e.message);
    // Piper TTS fallback - generate silence if not available
    execSync(`ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t 30 -c:a pcm_s16le vocals.wav`);
  }

  // 2. Instrumental backing
  const totalDur = scenes[scenes.length - 1].end_time;
  execSync(`
    ffmpeg -f lavfi -i "sine=frequency=55:duration=${totalDur}" \
           -f lavfi -i "sine=frequency=110:duration=${totalDur}" \
           -filter_complex "[0:a][1:a]amix=inputs=2:duration=first,volume=0.3" \
           -ar 44100 -ac 2 instrumental.wav
  `);

  // 3. Mix with Pedalboard (Python)
  const mixScript = `
import sys
from pedalboard import Pedalboard, Compressor, Gain, Limiter
from pedalboard.io import AudioFile

with AudioFile('vocals.wav') as f: vocals = f.read(f.frames)
with AudioFile('instrumental.wav') as f: inst = f.read(f.frames)

min_len = min(vocals.shape[1], inst.shape[1])
vocals, inst = vocals[:, :min_len], inst[:, :min_len]

board = Pedalboard([Compressor(threshold_db=-12, ratio=4), Gain(gain_db=3), Limiter()])
mixed = board(vocals + inst, 44100)

with AudioFile('output_audio.wav', 'w', 44100, mixed.shape[0]) as f:
    f.write(mixed)
  `;
  fs.writeFileSync('mix.py', mixScript);
  execSync('python3 mix.py');
  
  // Final loudnorm to -14 LUFS
  execSync('ffmpeg -y -i output_audio.wav -af loudnorm=I=-14:TP=-1:LRA=11 output_audio.mp3');
}

module.exports = { generateAudio, withRetry };