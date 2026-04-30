// Cost-optimized model router.
// Tries the cheap model first. Escalates to the expensive model only if
// the cheap output is low-confidence or fails schema validation.

import Anthropic from '@anthropic-ai/sdk';

export interface SentimentResult {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
}

export interface RouterDecision {
  result: SentimentResult;
  model_used: string;
  escalated: boolean;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface RouterConfig {
  cheap_model: string;
  expensive_model: string;
  confidence_threshold: number;
  api_key: string;
}

// Anthropic published rates (USD per token), as of 2026-04-30.
// Update when rates change. Used for honest cost reporting.
const RATES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 0.0000008, output: 0.000004 },
  'claude-sonnet-4-6': { input: 0.000003, output: 0.000015 },
};

const SYSTEM_PROMPT = `You are a trading sentiment classifier.
Classify the sentiment of the input text as exactly one of: "bullish", "bearish", or "neutral".
Return strict JSON only, no prose, no markdown fences:
{"sentiment": "bullish" | "bearish" | "neutral", "confidence": 0.0-1.0, "reasoning": "<one sentence>"}
Confidence reflects how clear the signal is. Use < 0.75 for ambiguous text.`;

export async function route(
  input: string,
  config: RouterConfig
): Promise<RouterDecision> {
  const cheap = await callModel(input, config.cheap_model, config.api_key);
  const cheapResult = parseSentiment(cheap.text);

  if (cheapResult && cheapResult.confidence >= config.confidence_threshold) {
    return {
      result: cheapResult,
      model_used: config.cheap_model,
      escalated: false,
      cost_usd: tokenCost(config.cheap_model, cheap.input_tokens, cheap.output_tokens),
      input_tokens: cheap.input_tokens,
      output_tokens: cheap.output_tokens,
    };
  }

  // Escalate: cheap output was malformed or low-confidence.
  const expensive = await callModel(input, config.expensive_model, config.api_key);
  const expensiveResult = parseSentiment(expensive.text);

  if (!expensiveResult) {
    throw new Error('Both models returned unparseable output');
  }

  const totalCost =
    tokenCost(config.cheap_model, cheap.input_tokens, cheap.output_tokens) +
    tokenCost(config.expensive_model, expensive.input_tokens, expensive.output_tokens);

  return {
    result: expensiveResult,
    model_used: config.expensive_model,
    escalated: true,
    cost_usd: totalCost,
    input_tokens: cheap.input_tokens + expensive.input_tokens,
    output_tokens: cheap.output_tokens + expensive.output_tokens,
  };
}

interface ModelCall {
  text: string;
  input_tokens: number;
  output_tokens: number;
}

async function callModel(
  input: string,
  model: string,
  apiKey: string
): Promise<ModelCall> {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: input }],
  });

  const block = resp.content[0];
  const text = block && block.type === 'text' ? block.text : '';

  return {
    text,
    input_tokens: resp.usage.input_tokens,
    output_tokens: resp.usage.output_tokens,
  };
}

export function parseSentiment(text: string): SentimentResult | null {
  // Strip common wrappers (markdown fences, leading whitespace) before parsing.
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const sentiment = obj['sentiment'];
  const confidence = obj['confidence'];
  const reasoning = obj['reasoning'];

  if (sentiment !== 'bullish' && sentiment !== 'bearish' && sentiment !== 'neutral') {
    return null;
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return null;
  }
  if (typeof reasoning !== 'string') {
    return null;
  }

  return { sentiment, confidence, reasoning };
}

export function tokenCost(model: string, input_tokens: number, output_tokens: number): number {
  const rate = RATES[model];
  if (!rate) return 0;
  return rate.input * input_tokens + rate.output * output_tokens;
}
