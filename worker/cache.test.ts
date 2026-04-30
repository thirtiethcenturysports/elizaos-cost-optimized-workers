import { describe, it, expect } from 'vitest';
import { cacheKey, sha256Hex } from './cache';

describe('cacheKey', () => {
  it('returns the same key for same model + same input', async () => {
    const a = await cacheKey('claude-haiku-4-5', 'BTC ripping');
    const b = await cacheKey('claude-haiku-4-5', 'BTC ripping');
    expect(a).toBe(b);
  });

  it('normalizes whitespace and case', async () => {
    const a = await cacheKey('claude-haiku-4-5', '  BTC RIPPING  ');
    const b = await cacheKey('claude-haiku-4-5', 'btc ripping');
    expect(a).toBe(b);
  });

  it('returns different keys for different models', async () => {
    const a = await cacheKey('claude-haiku-4-5', 'BTC ripping');
    const b = await cacheKey('claude-sonnet-4-6', 'BTC ripping');
    expect(a).not.toBe(b);
  });

  it('returns different keys for different inputs', async () => {
    const a = await cacheKey('claude-haiku-4-5', 'BTC ripping');
    const b = await cacheKey('claude-haiku-4-5', 'BTC dumping');
    expect(a).not.toBe(b);
  });

  it('uses cache: prefix', async () => {
    const k = await cacheKey('claude-haiku-4-5', 'x');
    expect(k.startsWith('cache:')).toBe(true);
  });
});

describe('sha256Hex', () => {
  it('matches known hash for empty string', async () => {
    const h = await sha256Hex('');
    expect(h).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches known hash for "abc"', async () => {
    const h = await sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
