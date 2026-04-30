// @thirtieth/elizaos-plugin-cf-cost-router
//
// ElizaOS plugin that routes LLM classification through a Cloudflare Worker
// running cost-optimized model routing (Haiku-first, Sonnet on low confidence)
// with KV response cache and append-only audit log.
//
// Usage in an ElizaOS character config:
//
//   import costRouter from '@thirtieth/elizaos-plugin-cf-cost-router';
//
//   export const character: Character = {
//     plugins: [costRouter],
//     settings: {
//       COST_ROUTER_URL: 'https://elizaos-cost-router.<your-subdomain>.workers.dev',
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

const DEFAULT_URL = 'http://localhost:8787';

function getRouterUrl(runtime: IAgentRuntime): string {
  const raw = runtime.getSetting('COST_ROUTER_URL');
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_URL;
}

const classifyTradingSentiment: Action = {
  name: 'CLASSIFY_TRADING_SENTIMENT',
  similes: ['ANALYZE_SENTIMENT', 'SENTIMENT_CHECK', 'MARKET_MOOD'],
  description:
    'Classify the sentiment of a trading-related message as bullish, bearish, or neutral via a cost-optimized Cloudflare Worker. Returns confidence, reasoning, and which model handled it.',

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

    const url = `${getRouterUrl(runtime)}/classify`;
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
      return { success: false, error: `cost-router fetch failed: ${msg}` };
    }

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        error: `cost-router returned ${response.status}: ${body}`,
      };
    }

    const data = (await response.json()) as ClassifyResponse;

    const summary = data.cache_hit
      ? `Sentiment: ${data.result.sentiment} (cached, free)`
      : `Sentiment: ${data.result.sentiment} (${data.model_used}${data.escalated ? ', escalated' : ''}, $${data.cost_usd.toFixed(6)})`;

    if (callback) {
      await callback({ text: summary, source: 'cost-router' });
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

export const costRouterPlugin: Plugin = {
  name: 'cost-router',
  description:
    'Routes LLM classification through a cost-optimized Cloudflare Worker (Haiku-first, Sonnet on low confidence) with KV cache and append-only audit log.',
  actions: [classifyTradingSentiment],
};

export default costRouterPlugin;
