// src/index.js - Cloudflare Worker Orchestrator
export default {
  async cronTrigger(event, env, ctx) {
    ctx.waitUntil(handleOrchestrationLoop(env));
  },

  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    
    const url = new URL(request.url);
    if (url.pathname === "/webhook/callback") {
      const { production_uuid, next_state, data } = await request.json();
      
      await env.DB.prepare(
        `UPDATE production_jobs 
         SET current_state = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE production_uuid = ?`
      ).bind(next_state, JSON.stringify(data), production_uuid).run();

      ctx.waitUntil(processState(production_uuid, next_state, env));
      return new Response("State updated, proceeding.", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  }
};

const MACRO_STAGES = [
  'SCHEDULED', 'DISCOVER', 'CREATIVE', 'GENERATE', 
  'RENDER', 'SIGN', 'PUBLISH', 'LEARN'
];

async function handleOrchestrationLoop(env) {
  const uuid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO production_jobs (production_uuid, current_state) VALUES (?, 'SCHEDULED')"
  ).bind(uuid).run();
  await processState(uuid, 'SCHEDULED', env);
}

async function processState(uuid, state, env) {
  const idx = MACRO_STAGES.indexOf(state);
  if (idx === -1 || idx === MACRO_STAGES.length - 1) return;
  
  const nextState = MACRO_STAGES[idx + 1];
  await triggerGitHubWorkflow(uuid, nextState, env);
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