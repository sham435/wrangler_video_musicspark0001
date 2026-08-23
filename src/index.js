// src/index.js - Cloudflare Worker Orchestrator
const MAX_SHORTS_PER_DAY = 10;

const MACRO_STAGES = [
  'SCHEDULED', 'DISCOVER', 'CREATIVE', 'GENERATE', 
  'RENDER', 'SIGN', 'PUBLISH', 'LEARN'
];

const STAGE_ORDER = {
  'SCHEDULED': 0, 'DISCOVER': 1, 'CREATIVE': 2, 'GENERATE': 3,
  'RENDER': 4, 'SIGN': 5, 'PUBLISH': 6, 'LEARN': 7
};

export default {
  async cronTrigger(event, env, ctx) {
    ctx.waitUntil(handleOrchestrationLoop(env, false));
  },

  async fetch(request, env, ctx) {
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    
    const url = new URL(request.url);
    
    // Webhook callback from GitHub Actions
    if (url.pathname === "/webhook/callback" && request.method === "POST") {
      const { production_uuid, completed_stage, data } = await request.json();
      
      await env.DB.prepare(
        `UPDATE production_jobs 
         SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE production_uuid = ?`
      ).bind(JSON.stringify(data), production_uuid).run();

      ctx.waitUntil(dispatchNextStage(production_uuid, completed_stage, env));
      return new Response("Stage completed, dispatching next.", { status: 200 });
    }
    
    // Manual trigger endpoint for testing (bypasses daily limit)
    if (url.pathname === "/trigger" && request.method === "POST") {
      const isTest = url.searchParams.get("test") === "true" || 
                     request.headers.get("X-Test-Mode") === "true";
      ctx.waitUntil(handleOrchestrationLoop(env, isTest));
      return new Response(isTest ? "Test production started" : "Production started", { status: 200 });
    }
    
    // Artifact download endpoint
    if (url.pathname.startsWith("/artifacts/") && request.method === "GET") {
      const uuid = url.pathname.split("/artifacts/")[1];
      const key = `artifacts:${uuid}`;
      const stored = await env.KV.get(key, { type: 'json' });
      if (!stored) {
        return new Response(JSON.stringify({ files: {} }), { status: 200, headers: { 'Content-Type': 'application/json' }});
      }
      return new Response(JSON.stringify(stored), { headers: { 'Content-Type': 'application/json' }});
    }
    
    // Artifact upload endpoint
    if (url.pathname.startsWith("/artifacts/") && request.method === "POST") {
      const uuid = url.pathname.split("/artifacts/")[1];
      const { files } = await request.json();
      const key = `artifacts:${uuid}`;
      
      // Merge with existing artifacts
      const existing = await env.KV.get(key, { type: 'json' }) || { files: {} };
      existing.files = { ...existing.files, ...files };
      existing.updated_at = new Date().toISOString();
      
      await env.KV.put(key, JSON.stringify(existing));
      return new Response("Artifacts stored", { status: 200 });
    }
    
    return new Response("Not Found", { status: 404 });
  }
};

async function handleOrchestrationLoop(env, isTest = false) {
  if (!isTest) {
    const today = new Date().toISOString().split('T')[0];
    const count = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM production_jobs 
       WHERE date(created_at) = ?`
    ).bind(today).first();
    
    if (count && count.cnt >= MAX_SHORTS_PER_DAY) {
      console.log(`Daily limit reached: ${count.cnt}/${MAX_SHORTS_PER_DAY} shorts for ${today}`);
      return;
    }
  }

  const uuid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO production_jobs (production_uuid, current_state) VALUES (?, 'SCHEDULED')"
  ).bind(uuid).run();
  
  await triggerGitHubWorkflow(uuid, 'DISCOVER', env);
}

async function dispatchNextStage(uuid, completedStage, env) {
  const completedIdx = STAGE_ORDER[completedStage];
  if (completedIdx === undefined || completedIdx >= MACRO_STAGES.length - 1) {
    console.log(`Production ${uuid} completed all stages`);
    return;
  }
  
  const nextStage = MACRO_STAGES[completedIdx + 1];
  
  await env.DB.prepare(
    `UPDATE production_jobs 
     SET current_state = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE production_uuid = ?`
  ).bind(nextStage, uuid).run();
  
  await triggerGitHubWorkflow(uuid, nextStage, env);
}

async function triggerGitHubWorkflow(uuid, stage, env) {
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/production-pipeline.yml/dispatches`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GH_PAT}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "CF-Orchestrator"
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { production_uuid: uuid, execution_stage: stage }
    })
  });
}