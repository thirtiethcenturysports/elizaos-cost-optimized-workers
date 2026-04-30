import { describe, it, expect } from 'vitest';
import { parseSentiment, tokenCost } from './router';

describe('parseSentiment', () => {
  it('parses well-formed JSON', () => {
    const result = parseSentiment(
      '{"sentiment":"bullish","confidence":0.9,"reasoning":"breakout"}'
    );
    expect(result).toEqual({ sentiment: 'bullish', confidence: 0.9, reasoning: 'breakout' });
  });

  it('strips markdown fences', () => {
    const result = parseSentiment(
      '```json\n{"sentiment":"bearish","confidence":0.8,"reasoning":"r"}\n```'
    );
    expect(result?.sentiment).toBe('bearish');
  });

  it('rejects invalid sentiment values', () => {
    expect(
      parseSentiment('{"sentiment":"euphoric","confidence":0.9,"reasoning":"x"}')
    ).toBeNull();
  });

  it('rejects out-of-range confidence', () => {
    expect(
      parseSentiment('{"sentiment":"neutral","confidence":1.5,"reasoning":"x"}')
    ).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseSentiment('not json at all')).toBeNull();
  });

  it('rejects missing reasoning', () => {
    expect(parseSentiment('{"sentiment":"neutral","confidence":0.5}')).toBeNull();
  });
});

describe('tokenCost', () => {
  it('computes Haiku cost from published rates', () => {
    // 1000 input + 500 output @ haiku-4-5: 1000 * 8e-7 + 500 * 4e-6 = 0.0008 + 0.002 = 0.0028
    expect(tokenCost('claude-haiku-4-5', 1000, 500)).toBeCloseTo(0.0028, 6);
  });

  it('computes Sonnet cost from published rates', () => {
    // 1000 input + 500 output @ sonnet-4-6: 1000 * 3e-6 + 500 * 1.5e-5 = 0.003 + 0.0075 = 0.0105
    expect(tokenCost('claude-sonnet-4-6', 1000, 500)).toBeCloseTo(0.0105, 6);
  });

  it('returns 0 for unknown model', () => {
    expect(tokenCost('claude-unknown', 1000, 500)).toBe(0);
  });
});
