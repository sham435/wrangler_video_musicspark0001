// scripts/stages/publish.js
const axios = require('axios');
const fs = require('fs');

async function uploadVideo() {
  const fileSize = fs.statSync('final_unsigned.mp4').size;
  
  const initRes = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable',
    {
      snippet: { title: 'Processing...', description: '', tags: [], categoryId: '10' },
      status: { privacyStatus: 'private' }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.YOUTUBE_OAUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': fileSize
      }
    }
  );
  
  const uploadUrl = initRes.headers.location;
  const file = fs.readFileSync('final_unsigned.mp4');
  const chunkSize = 10 * 1024 * 1024;
  
  for (let start = 0; start < fileSize; start += chunkSize) {
    const end = Math.min(start + chunkSize, fileSize);
    const chunk = file.slice(start, end);
    
    await axios.put(uploadUrl, chunk, {
      headers: {
        'Content-Range': `bytes ${start}-${end-1}/${fileSize}`,
        'Content-Length': chunk.length
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
  }
  
  const videoId = await getVideoIdFromUploadUrl(uploadUrl);
  fs.writeFileSync('publish_result.json', JSON.stringify({ videoId }));
  return videoId;
}

async function getVideoIdFromUploadUrl(url) {
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${process.env.YOUTUBE_OAUTH_TOKEN}` } });
  return res.data.id;
}

async function waitProcessing(videoId) {
  const intervals = [60, 120, 300, 600, 1200];
  for (const interval of intervals) {
    await new Promise(r => setTimeout(r, interval * 1000));
    const res = await axios.get(`https://www.googleapis.com/youtube/v3/videos?part=processingDetails,status&id=${videoId}`, {
      headers: { Authorization: `Bearer ${process.env.YOUTUBE_OAUTH_TOKEN}` }
    });
    const details = res.data.items[0];
    if (details.processingDetails.processingStatus === 'succeeded') return;
    if (details.status.uploadStatus === 'failed') throw new Error('YouTube processing failed');
  }
  throw new Error('Processing timeout');
}

async function setThumbnail(videoId) {
  await axios.post(
    `https://www.googleapis.com/youtube/v3/thumbnails/set?videoId=${videoId}`,
    fs.readFileSync('final_thumbnail.jpg'),
    {
      headers: {
        Authorization: `Bearer ${process.env.YOUTUBE_OAUTH_TOKEN}`,
        'Content-Type': 'image/jpeg'
      }
    }
  );
}

async function verifyThumbnail(videoId) {
  const res = await axios.get(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`, {
    headers: { Authorization: `Bearer ${process.env.YOUTUBE_OAUTH_TOKEN}` }
  });
  const thumbUrl = res.data.items[0].snippet.thumbnails.maxres?.url || 
                   res.data.items[0].snippet.thumbnails.high?.url;
  const remote = await axios.get(thumbUrl, { responseType: 'arraybuffer' });
  const local = fs.readFileSync('final_thumbnail.jpg');
  if (Buffer.compare(Buffer.from(remote.data), local) !== 0) {
    throw new Error('Thumbnail hash mismatch');
  }
}

async function setMetadata(videoId) {
  const meta = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
  await axios.put(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status`,
    {
      id: videoId,
      snippet: meta.snippet,
      status: { privacyStatus: 'private' }
    },
    { headers: { Authorization: `Bearer ${process.env.YOUTUBE_OAUTH_TOKEN}` }}
  );
}

async function publishVideo(videoId) {
  await axios.put(
    `https://www.googleapis.com/youtube/v3/videos?part=status`,
    { id: videoId, status: { privacyStatus: 'public' } },
    { headers: { Authorization: `Bearer ${process.env.YOUTUBE_OAUTH_TOKEN}` }}
  );
}

async function verifyPublication(videoId) {
  const res = await axios.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  if (res.status !== 200) throw new Error('Public verification failed');
}

module.exports = { uploadVideo, waitProcessing, setThumbnail, verifyThumbnail, setMetadata, publishVideo, verifyPublication };