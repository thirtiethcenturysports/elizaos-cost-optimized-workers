// KV-backed response cache with content-hash keys and TTL.
// Hit avoids the Anthropic call entirely. TTL is enforced by KV's expirationTtl.
//
// Cache key = sha256(model + ":" + normalized_input). Same input + same model
// = same key, deterministically.

export interface CacheValue {
  result: unknown;
  model: string;
  cached_at: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
}

const STATS_KEY = 'cache:stats';

export class ResponseCache {
  constructor(
    private readonly kv: KVNamespace,
    private readonly ttlSeconds: number
  ) {}

  async get(model: string, input: string): Promise<CacheValue | null> {
    const key = await cacheKey(model, input);
    const raw = await this.kv.get(key, 'json');
    if (!raw) {
      await this.bumpStat('misses');
      return null;
    }
    await this.bumpStat('hits');
    return raw as CacheValue;
  }

  async put(model: string, input: string, result: unknown): Promise<void> {
    const key = await cacheKey(model, input);
    const value: CacheValue = {
      result,
      model,
      cached_at: Date.now(),
    };
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: this.ttlSeconds,
    });
  }

  async stats(): Promise<CacheStats> {
    const raw = await this.kv.get(STATS_KEY, 'json');
    if (!raw) return { hits: 0, misses: 0 };
    return raw as CacheStats;
  }

  private async bumpStat(field: keyof CacheStats): Promise<void> {
    // Read-modify-write on KV. Concurrent bumps can lose increments. Acceptable
    // for a demo stats counter; for production swap to a Durable Object.
    const current = await this.stats();
    current[field] += 1;
    await this.kv.put(STATS_KEY, JSON.stringify(current));
  }
}

export async function cacheKey(model: string, input: string): Promise<string> {
  const normalized = `${model}:${input.trim().toLowerCase()}`;
  const hash = await sha256Hex(normalized);
  return `cache:${hash}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
