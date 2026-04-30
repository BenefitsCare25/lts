// =============================================================
// Application-level encryption for tenant-supplied secrets
// (Azure AI Foundry API keys, future BYOK credentials).
//
// Algorithm: AES-256-GCM — authenticated encryption with random
// 12-byte IV per call, 16-byte auth tag. Master key is derived
// from APP_SECRET_KEY via scrypt with a fixed salt; rotating the
// master key is a Phase 2 task (would require re-encrypting all
// rows with a version bump).
//
// Output format: `v1.<base64url(iv ‖ ciphertext ‖ authTag)>`
//   - "v1." prefix reserves room for key rotation (v2, v3, ...)
//   - base64url avoids '+'/'/' which break in URL contexts
//
// Production checklist:
//   - APP_SECRET_KEY must be 32+ random bytes (base64 or hex)
//   - In dev a fallback key is used (with warning) — sessions
//     and stored secrets will not survive a key change
//
// Why not AWS KMS / Azure Key Vault: Phase 2. For now this lets
// the SaaS run end-to-end without external KMS dependencies and
// still encrypt at rest in Postgres.
// =============================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// Fixed salt is acceptable here because the master key is itself
// a high-entropy secret. Rotating the salt would force a re-encrypt
// of all rows; the salt does not need to be unique per ciphertext
// the way the IV does.
const SALT = Buffer.from('insurance-saas:secret-cipher:v1');

const VERSION_PREFIX = 'v1.';

let _masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;
  const raw = process.env.APP_SECRET_KEY;
  if (raw && raw.length >= 16) {
    _masterKey = scryptSync(raw, SALT, KEY_LENGTH);
    return _masterKey;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_SECRET_KEY is missing or too short. Set a 32+ char random string in your environment before persisting any encrypted secrets.',
    );
  }
  // Dev fallback: deterministic so secrets survive restart, but
  // explicitly logged so it can never accidentally ship.
  process.stderr.write(
    '[secret-cipher] APP_SECRET_KEY not set — using dev-only fallback key. Encrypted values will NOT decrypt in another environment.\n',
  );
  _masterKey = scryptSync('insurance-saas-dev-fallback', SALT, KEY_LENGTH);
  return _masterKey;
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret: plaintext must be a non-empty string.');
  }
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const envelope = Buffer.concat([iv, ciphertext, authTag]);
  return VERSION_PREFIX + envelope.toString('base64url');
}

export function decryptSecret(envelope: string): string {
  if (typeof envelope !== 'string' || !envelope.startsWith(VERSION_PREFIX)) {
    throw new Error('decryptSecret: unrecognised envelope format.');
  }
  const key = getMasterKey();
  const buf = Buffer.from(envelope.slice(VERSION_PREFIX.length), 'base64url');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('decryptSecret: envelope is too short.');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

// Convenience: take last 4 chars of a key for masked display.
// Caller should never log or persist the full key.
export function lastFour(plaintextKey: string): string {
  if (plaintextKey.length <= 4) return plaintextKey;
  return plaintextKey.slice(-4);
}
