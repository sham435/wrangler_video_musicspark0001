# Autonomous AI Music Shorts Factory

Zero-human-intervention production pipeline for AI-generated music shorts.

## Architecture

```
Cloudflare Worker (Orchestrator) → GitHub Actions (Heavy Compute) → YouTube (Publish)
```

- **Orchestrator**: Cloudflare Workers + D1 (state machine, cron trigger)
- **Compute**: GitHub Actions runners (FFmpeg, Python, Node.js, c2patool)
- **Storage**: Cloudflare KV/R2 (prompts, stems), D1 (state, analytics)

## Quick Start

### 1. Cloudflare Setup

```bash
# Install wrangler
npm install -g wrangler

# Login
wrangler login

# Create D1 database
wrangler d1 create autonomous-shorts-db
# Note the database_id and update wrangler.jsonc

# Create KV namespace
wrangler kv:namespace create "CACHE"
# Note the id and update wrangler.jsonc

# Deploy Worker
wrangler deploy
# Note the worker URL (e.g., https://autonomous-shorts-orchestrator.your-subdomain.workers.dev)
```

### 2. GitHub Repository Setup

Push this repo to GitHub, then add these **Secrets** (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `CF_WORKER_URL` | Your deployed Worker URL + `/webhook/callback` |
| `GH_PAT` | Personal Access Token (repo scope) |
| `GH_OWNER` | Your GitHub username |
| `GH_REPO` | Repository name (video_musicspark) |
| `OPENAI_API_KEY` | OpenAI API key (gpt-4o-mini) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `YOUTUBE_OAUTH_TOKEN` | OAuth access token (refreshable) |
| `YOUTUBE_CLIENT_ID` | OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | OAuth client secret |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `HUGGINGFACE_API_KEY` | HF Inference API token |
| `C2PA_CERT_PEM` | (Optional) C2PA certificate PEM |
| `C2PA_KEY_PEM` | (Optional) C2PA private key PEM |

### 3. C2PA Certificate (One-time)

```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=AutonomousShortsFactory"
# Add cert.pem content to C2PA_CERT_PEM secret
# Add key.pem content to C2PA_KEY_PEM secret
```

### 4. YouTube OAuth Token Refresh

The worker doesn't handle token refresh. Implement a separate cron job or use a GitHub Action to refresh the token:

```bash
# Refresh script (run periodically)
curl -X POST https://oauth2.googleapis.com/token \
  -d client_id=$YOUTUBE_CLIENT_ID \
  -d client_secret=$YOUTUBE_CLIENT_SECRET \
  -d refresh_token=$YOUTUBE_REFRESH_TOKEN \
  -d grant_type=refresh_token
```

### 5. Test Run

Trigger manually via GitHub Actions UI or API:

```bash
gh workflow run production-pipeline.yml \
  -f production_uuid=test-$(date +%s) \
  -f execution_stage=SCHEDULED
```

## Stage Flow

| Stage | Description | Compute |
|-------|-------------|---------|
| SCHEDULED | Init UUID, dispatch DISCOVER | Worker |
| DISCOVER | Trends from YT/HN/Reddit | GH Actions |
| CREATIVE | LLM storyboard + scene plan | GH Actions |
| GENERATE | Visuals (Pollinations/HF) + Audio (ElevenLabs/Piper) | GH Actions |
| RENDER | FFmpeg concat + .ass subtitles + thumbnails | GH Actions |
| SIGN | Preflight (LUFS/FPS) + C2PA sign | GH Actions |
| PUBLISH | YouTube resumable upload + metadata + publish | GH Actions |
| LEARN | Sync to git, collect analytics, update prompts | GH Actions |

## Free Tier Limits

| Resource | Limit | Est. Videos/Mo |
|----------|-------|----------------|
| GH Actions | 2,000 min | ~150 |
| CF Workers | 100k req/day | 3,750 |
| CF D1 | 5M reads | 50,000 |
| YouTube API | 10k units/day | 3,000 |
| ElevenLabs | 10k chars/mo | 20 |

**Bottleneck**: GitHub Actions minutes (~150 videos/mo practical)

## File Structure

```
.
├── src/index.js                    # Cloudflare Worker
├── wrangler.jsonc                  # CF Worker config
├── .github/workflows/
│   └── production-pipeline.yml     # GH Actions workflow
├── scripts/
│   ├── engine-runner.js            # Main entry point
│   └── stages/
│       ├── discover.js             # Trends collection
│       ├── creative.js             # LLM storyboard/scenes
│       ├── visuals.js              # Image generation
│       ├── audio.js                # Audio generation/mixing
│       ├── render.js               # FFmpeg render + thumbnails
│       ├── preflight.js            # QA checks
│       ├── c2pa.js                 # C2PA signing
│       ├── publish.js              # YouTube upload/publish
│       └── learn.js                # Memory/prompt update
└── package.json
```

## Monitoring

- **Worker logs**: `wrangler tail`
- **D1 state**: `wrangler d1 execute autonomous-shorts-db --command "SELECT * FROM production_jobs"`
- **GH Actions**: Actions tab in GitHub

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Worker can't trigger GH | Check `GH_PAT` has `repo` scope, `GH_OWNER`/`GH_REPO` correct |
| Visuals fail | Check `HUGGINGFACE_API_KEY` valid, Pollinations is free fallback |
| Audio fails | Check `ELEVENLABS_API_KEY` quota, Piper fallback creates silence |
| Upload fails | Verify `YOUTUBE_OAUTH_TOKEN` not expired, refresh if needed |
| C2PA verify fails | Ensure `c2patool` installed, cert/key valid |

## License

MIT