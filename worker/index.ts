// Cloudflare Worker entry.
// Routes:
//   POST /classify       { text, task_id? } -> sentiment + cost telemetry
//   GET  /audit/:taskId  -> entries for that task, in order
//   GET  /audit/:taskId/verify -> chain integrity check
//   GET  /stats          -> cache hit/miss + cumulative cost
//   GET  /health         -> ok

import { ResponseCache } from './cache';
import { AuditLog } from './audit-log';
import { route, type RouterConfig } from './router';

interface Env {
  ROUTER_KV: KVNamespace;
  ANTHROPIC_API_KEY: string;
  CACHE_TTL_SECONDS: string;
  CONFIDENCE_THRESHOLD: string;
  CHEAP_MODEL: string;
  EXPENSIVE_MODEL: string;
}

interface ClassifyBody {
  text?: unknown;
  task_id?: unknown;
}

const WORKER_ID = 'elizaos-cost-router';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/stats') {
      const cache = new ResponseCache(env.ROUTER_KV, parseInt(env.CACHE_TTL_SECONDS, 10));
      return json(await cache.stats());
    }

    if (request.method === 'GET' && url.pathname.startsWith('/audit/')) {
      const segs = url.pathname.split('/').filter(Boolean);
      const taskId = segs[1];
      if (!taskId) return json({ error: 'task_id required' }, 400);
      const log = new AuditLog(env.ROUTER_KV);
      if (segs[2] === 'verify') {
        return json(await log.verifyChain(taskId));
      }
      return json(await log.getLog(taskId));
    }

    if (request.method === 'POST' && url.pathname === '/classify') {
      return handleClassify(request, env);
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;

async function handleClassify(request: Request, env: Env): Promise<Response> {
  let body: ClassifyBody;
  try {
    body = (await request.json()) as ClassifyBody;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (typeof body.text !== 'string' || body.text.trim().length === 0) {
    return json({ error: 'text required' }, 400);
  }

  const text = body.text;
  const task_id = typeof body.task_id === 'string' ? body.task_id : crypto.randomUUID();

  const cache = new ResponseCache(env.ROUTER_KV, parseInt(env.CACHE_TTL_SECONDS, 10));
  const audit = new AuditLog(env.ROUTER_KV);

  const config: RouterConfig = {
    cheap_model: env.CHEAP_MODEL,
    expensive_model: env.EXPENSIVE_MODEL,
    confidence_threshold: parseFloat(env.CONFIDENCE_THRESHOLD),
    api_key: env.ANTHROPIC_API_KEY,
  };

  const started = Date.now();

  // Cache lookup keyed by cheap-model input. A hit means we previously
  // resolved this exact text and can skip the model call entirely.
  const cached = await cache.get(config.cheap_model, text);
  if (cached) {
    const latency_ms = Date.now() - started;
    await audit.append({
      task_id,
      worker_id: WORKER_ID,
      decision: 'cache_hit',
      model_used: config.cheap_model,
      escalated: false,
      cost_usd: 0,
      latency_ms,
      cache_hit: true,
    });
    return json({
      task_id,
      result: cached.result,
      model_used: config.cheap_model,
      escalated: false,
      cache_hit: true,
      cost_usd: 0,
      latency_ms,
    });
  }

  let decision;
  try {
    decision = await route(text, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 502);
  }

  const latency_ms = Date.now() - started;

  await cache.put(config.cheap_model, text, decision.result);
  await audit.append({
    task_id,
    worker_id: WORKER_ID,
    decision: decision.escalated ? 'escalated' : 'cheap_only',
    model_used: decision.model_used,
    escalated: decision.escalated,
    cost_usd: decision.cost_usd,
    latency_ms,
    cache_hit: false,
  });

  return json({
    task_id,
    result: decision.result,
    model_used: decision.model_used,
    escalated: decision.escalated,
    cache_hit: false,
    cost_usd: decision.cost_usd,
    input_tokens: decision.input_tokens,
    output_tokens: decision.output_tokens,
    latency_ms,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
