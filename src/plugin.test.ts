import { describe, it, expect } from 'vitest';
import { UUID_RE } from './plugin';

describe('UUID_RE (decision log task_id matcher)', () => {
  it('matches a real v4 UUID', () => {
    const m = 'verify task 9b6e7c3a-2e4d-4f5a-9c1d-7e2b8a6f3d10 please'.match(UUID_RE);
    expect(m?.[0]).toBe('9b6e7c3a-2e4d-4f5a-9c1d-7e2b8a6f3d10');
  });

  it('matches case-insensitively', () => {
    const m = '9B6E7C3A-2E4D-4F5A-9C1D-7E2B8A6F3D10'.match(UUID_RE);
    expect(m).not.toBeNull();
  });

  it('does NOT match hex-only English words like "feedback"', () => {
    expect(UUID_RE.test('the feedback was good')).toBe(false);
    expect(UUID_RE.test('decade ago')).toBe(false);
    expect(UUID_RE.test('deadbeef cafe')).toBe(false);
    expect(UUID_RE.test('facade')).toBe(false);
  });

  it('does NOT match short ids without UUID shape', () => {
    expect(UUID_RE.test('verify abc123def')).toBe(false);
    expect(UUID_RE.test('id 12345678')).toBe(false);
  });

  it('does NOT match malformed UUIDs', () => {
    expect(UUID_RE.test('9b6e7c3a-2e4d-4f5a-9c1d')).toBe(false); // truncated
    expect(UUID_RE.test('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')).toBe(false); // non-hex
  });

  it('does not over-match across a sentence with hex words around it', () => {
    const text = 'the feedback was for task 9b6e7c3a-2e4d-4f5a-9c1d-7e2b8a6f3d10 in cafe';
    const m = text.match(UUID_RE);
    expect(m?.[0]).toBe('9b6e7c3a-2e4d-4f5a-9c1d-7e2b8a6f3d10');
  });
});
