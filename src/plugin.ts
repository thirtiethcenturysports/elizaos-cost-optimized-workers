// @thirtieth/elizaos-plugin-cloudflare
//
// Cloudflare integration for ElizaOS agents. The plugin exposes Actions that
// route through a deployed Cloudflare Worker. The Worker handles:
//
//   - KV-backed response cache (sha256 content keys, TTL eviction)
//   - Replayable per-task decision log (chain-hashed, integrity-checkable
//     against a known-good copy; see docs/append-only-logging.md for limits)
//   - Experimental cost-aware model router (Haiku-first with optional
//     escalation to Sonnet; reproducible benchmark in bench/)
//
// Usage in an ElizaOS character config:
//
//   import cloudflarePlugin from '@thirtieth/elizaos-plugin-cloudflare';
//
//   export const character: Character = {
//     plugins: [cloudflarePlugin],
//     settings: {
//       CLOUDFLARE_WORKER_URL: 'https://elizaos-cloudflare.<sub>.workers.dev',
//       // Backwards-compatible alias also accepted: COST_ROUTER_URL
//     },
//   };

import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Plugin,
  State,
} from '@elizaos/core';

interface ClassifyResponse {
  task_id: string;
  result: {
    sentiment: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    reasoning: string;
  };
  model_used: string;
  escalated: boolean;
  cache_hit: boolean;
  cost_usd: number;
  latency_ms: number;
}

interface VerifyResponse {
  valid: boolean;
  broken_at?: number;
}

const DEFAULT_URL = 'http://localhost:8787';

// Strict UUID v4-ish shape. Anchored on word boundaries so we don't false-match
// hex-only English words like "feedback" or "decade" that happen to be 8+ chars.
export const UUID_RE = /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i;

function getWorkerUrl(runtime: IAgentRuntime): string {
  const newKey = runtime.getSetting('CLOUDFLARE_WORKER_URL');
  if (typeof newKey === 'string' && newKey.length > 0) return newKey;
  // Backwards compat with v0.1 setting name.
  const oldKey = runtime.getSetting('COST_ROUTER_URL');
  if (typeof oldKey === 'string' && oldKey.length > 0) return oldKey;
  return DEFAULT_URL;
}

const classifyTradingSentiment: Action = {
  name: 'CLASSIFY_TRADING_SENTIMENT',
  similes: ['ANALYZE_SENTIMENT', 'SENTIMENT_CHECK', 'MARKET_MOOD'],
  description:
    'Classify the sentiment of a trading-related message as bullish, bearish, or neutral via a Cloudflare Worker with response cache and decision log. Returns confidence, reasoning, model used, and cost telemetry.',

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text;
    return typeof text === 'string' && text.trim().length > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const text = message.content?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { success: false, error: 'no input text' };
    }

    const url = `${getWorkerUrl(runtime)}/classify`;
    const task_id = `${message.id ?? crypto.randomUUID()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, task_id }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `cloudflare worker fetch failed: ${msg}` };
    }

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        error: `cloudflare worker returned ${response.status}: ${body}`,
      };
    }

    const data = (await response.json()) as ClassifyResponse;

    const summary = data.cache_hit
      ? `Sentiment: ${data.result.sentiment} (cached, free)`
      : `Sentiment: ${data.result.sentiment} (${data.model_used}${data.escalated ? ', escalated' : ''}, $${data.cost_usd.toFixed(6)})`;

    if (callback) {
      await callback({ text: summary, source: 'cloudflare-worker' });
    }

    return {
      success: true,
      text: summary,
      values: {
        sentiment: data.result.sentiment,
        confidence: data.result.confidence,
      },
      data: {
        task_id: data.task_id,
        result: data.result,
        model_used: data.model_used,
        escalated: data.escalated,
        cache_hit: data.cache_hit,
        cost_usd: data.cost_usd,
        latency_ms: data.latency_ms,
      },
    };
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'BTC just broke 100k resistance, volume confirming.' },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'Sentiment: bullish (claude-haiku-4-5, $0.000012)',
          actions: ['CLASSIFY_TRADING_SENTIMENT'],
        },
      },
    ],
  ],
};

const verifyDecisionLog: Action = {
  name: 'VERIFY_DECISION_LOG',
  similes: ['CHECK_AUDIT_CHAIN', 'VERIFY_TASK_LOG', 'AUDIT_INTEGRITY_CHECK'],
  description:
    'Verify the integrity of the chain-hashed decision log for a given task_id. Returns valid=true if the chain reads as expected against the live KV store, or broken_at=<seq> if a hash mismatch is detected. Note: this checks integrity against the current KV state, which an actor with KV write access could rewrite top-down. Useful for detecting accidental corruption and outsider tampering of a copy, not for proving insider tamper-resistance.',

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = message.content?.text;
    return typeof text === 'string' && UUID_RE.test(text);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const text = message.content?.text ?? '';
    const match = text.match(UUID_RE);
    if (!match) {
      return { success: false, error: 'no task_id (UUID) found in message' };
    }
    const task_id = match[0];

    const url = `${getWorkerUrl(runtime)}/audit/${encodeURIComponent(task_id)}/verify`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `cloudflare worker fetch failed: ${msg}` };
    }

    if (!response.ok) {
      const body = await response.text();
      return { success: false, error: `verify returned ${response.status}: ${body}` };
    }

    const data = (await response.json()) as VerifyResponse;

    const summary = data.valid
      ? `Decision log for task ${task_id}: chain valid against current KV state.`
      : `Decision log for task ${task_id}: chain BROKEN at seq ${data.broken_at}.`;

    if (callback) {
      await callback({ text: summary, source: 'cloudflare-worker' });
    }

    return {
      success: true,
      text: summary,
      values: { valid: data.valid },
      data: { task_id, ...data },
    };
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: { text: 'verify decision log for task 9b6e7c3a-2e4d-4f5a-9c1d-7e2b8a6f3d10' },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'Decision log for task 9b6e7c3a-...: chain valid against current KV state.',
          actions: ['VERIFY_DECISION_LOG'],
        },
      },
    ],
  ],
};

export const cloudflarePlugin: Plugin = {
  name: 'cloudflare',
  description:
    'Cloudflare integration for ElizaOS agents. KV-backed response cache + replayable decision log with integrity check + experimental cost-aware model router, all running on a single Worker.',
  actions: [classifyTradingSentiment, verifyDecisionLog],
};

// Backwards-compatible alias for v0.1 imports.
export const costRouterPlugin = cloudflarePlugin;

export default cloudflarePlugin;
