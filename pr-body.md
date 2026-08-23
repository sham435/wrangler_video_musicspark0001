## Setup Required

This PR adds the complete autonomous AI music shorts production factory. The following secrets must be configured in **GitHub Settings → Secrets → Actions** before the workflow will run:

### Required Secrets (12)

| Secret | Description | Example |
|--------|-------------|---------|
| `CF_WORKER_URL` | Worker webhook callback URL | `https://autonomous-shorts-orchestrator.autonomous-shorts-factory.workers.dev/webhook/callback` |
| `GH_PAT` | GitHub PAT with `repo` scope | `ghp_xxx` |
| `GH_OWNER` | GitHub username | `sham435` |
| `OPENAI_API_KEY` | OpenAI API key (gpt-4o-mini) | `sk-xxx` |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key | `AIzaSy...` |
| `YOUTUBE_OAUTH_TOKEN` | OAuth access token (refreshable) | `ya29.xxx` |
| `YOUTUBE_CLIENT_ID` | OAuth client ID | `xxx.apps.googleusercontent.com` |
| `YOUTUBE_CLIENT_SECRET` | OAuth client secret | `GOCSPX-xxx` |
| `ELEVENLABS_API_KEY` | ElevenLabs API key | `xxx` |
| `HUGGINGFACE_API_KEY` | HF Inference API token | `hf_xxx` |

### Cloudflare Worker Secrets (already set)

- `C2PA_CERT_PEM` ✅
- `C2PA_KEY_PEM` ✅

### Worker Config Updates Needed

Update `wrangler.jsonc` with your GitHub username:
```json
"vars": {
  "GH_OWNER": "sham435",
  "GH_REPO": "wrangler_video_musicspark0001"
}
```

Then redeploy: `wrangler deploy`

### Test Run

After secrets are configured:
```bash
gh workflow run production-pipeline.yml -f production_uuid=test-1 -f execution_stage=SCHEDULED
```