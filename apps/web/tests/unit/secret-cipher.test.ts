// =============================================================
// secret-cipher round-trip + tamper-detection tests.
// =============================================================

import { decryptSecret, encryptSecret, lastFour } from '@/server/security/secret-cipher';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  // Pin a deterministic key for the test process so encrypted
  // values produced inside one test cannot accidentally cross-leak
  // into another via the cached _masterKey singleton.
  process.env.APP_SECRET_KEY = 'unit-test-key-do-not-use-anywhere-else-32+chars';
});

describe('secret-cipher', () => {
  it('round-trips a typical API key', () => {
    const plaintext = 'sk-azure-foundry-1234567890abcdef';
    const envelope = encryptSecret(plaintext);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain(plaintext);
    expect(decryptSecret(envelope)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-key-different-iv';
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it('rejects tampered ciphertext via GCM auth tag', () => {
    const plaintext = 'tamper-me';
    const envelope = encryptSecret(plaintext);
    // Flip a byte deep in the ciphertext region (after the v1. prefix
    // and IV but before the auth tag) — GCM should reject this.
    const tampered = `${envelope.slice(0, -10)}AAAAAAAAAA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects envelopes without the version prefix', () => {
    expect(() => decryptSecret('not-a-real-envelope')).toThrow(/envelope format/);
  });

  it('lastFour returns the last 4 chars or the whole string if shorter', () => {
    expect(lastFour('abcdefghij')).toBe('ghij');
    expect(lastFour('abcd')).toBe('abcd');
    expect(lastFour('xy')).toBe('xy');
  });
});
