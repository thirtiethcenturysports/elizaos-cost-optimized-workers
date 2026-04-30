// Append-only audit log over KV.
// Each entry stores prev_hash + entry_hash, forming a tamper-evident chain
// per task. Replay reads entries by task_id prefix in order.

import { sha256Hex } from './cache';

export interface AuditEntry {
  task_id: string;
  seq: number;
  timestamp: number;
  worker_id: string;
  decision: string;
  model_used: string;
  escalated: boolean;
  cost_usd: number;
  latency_ms: number;
  cache_hit: boolean;
  prev_hash: string;
  entry_hash: string;
}

export interface NewEntry {
  task_id: string;
  worker_id: string;
  decision: string;
  model_used: string;
  escalated: boolean;
  cost_usd: number;
  latency_ms: number;
  cache_hit: boolean;
}

const TAIL_PREFIX = 'audit:tail:';

export class AuditLog {
  constructor(private readonly kv: KVNamespace) {}

  async append(entry: NewEntry): Promise<AuditEntry> {
    const tail = await this.getTail(entry.task_id);
    const seq = tail ? tail.seq + 1 : 0;
    const prev_hash = tail ? tail.entry_hash : 'GENESIS';

    const partial: Omit<AuditEntry, 'entry_hash'> = {
      ...entry,
      seq,
      timestamp: Date.now(),
      prev_hash,
    };

    const entry_hash = await sha256Hex(JSON.stringify(partial));
    const full: AuditEntry = { ...partial, entry_hash };

    const key = entryKey(entry.task_id, seq);
    await this.kv.put(key, JSON.stringify(full));
    await this.kv.put(`${TAIL_PREFIX}${entry.task_id}`, JSON.stringify(full));

    return full;
  }

  async getLog(task_id: string): Promise<AuditEntry[]> {
    const list = await this.kv.list({ prefix: `audit:entry:${task_id}:` });
    const entries: AuditEntry[] = [];
    for (const key of list.keys) {
      const raw = await this.kv.get(key.name, 'json');
      if (raw) entries.push(raw as AuditEntry);
    }
    return entries.sort((a, b) => a.seq - b.seq);
  }

  async verifyChain(task_id: string): Promise<{ valid: boolean; broken_at?: number }> {
    const entries = await this.getLog(task_id);
    let prev = 'GENESIS';
    for (const entry of entries) {
      if (entry.prev_hash !== prev) {
        return { valid: false, broken_at: entry.seq };
      }
      const { entry_hash, ...rest } = entry;
      const recomputed = await sha256Hex(JSON.stringify(rest));
      if (recomputed !== entry_hash) {
        return { valid: false, broken_at: entry.seq };
      }
      prev = entry_hash;
    }
    return { valid: true };
  }

  private async getTail(task_id: string): Promise<AuditEntry | null> {
    const raw = await this.kv.get(`${TAIL_PREFIX}${task_id}`, 'json');
    return raw ? (raw as AuditEntry) : null;
  }
}

function entryKey(task_id: string, seq: number): string {
  return `audit:entry:${task_id}:${String(seq).padStart(10, '0')}`;
}
