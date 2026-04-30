import {
  assertAuthConfigured,
  getAuthEnv,
  isAuthConfigured,
  validateEnvOnBoot,
} from '@/server/env';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REQUIRED = ['AUTH_SECRET'] as const;

describe('server/env', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of REQUIRED) {
      original[key] = process.env[key];
    }
    original.NODE_ENV = process.env.NODE_ENV;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  function setEnv(values: Partial<Record<string, string | undefined>>): void {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  it('isAuthConfigured returns false when AUTH_SECRET is missing', () => {
    setEnv({ AUTH_SECRET: undefined });
    expect(isAuthConfigured()).toBe(false);
  });

  it('isAuthConfigured returns true when AUTH_SECRET is present', () => {
    setEnv({ AUTH_SECRET: 'a'.repeat(32) });
    expect(isAuthConfigured()).toBe(true);
  });

  it('treats empty string the same as undefined', () => {
    setEnv({ AUTH_SECRET: '' });
    expect(isAuthConfigured()).toBe(false);
  });

  it('assertAuthConfigured throws with the missing key when not configured', () => {
    setEnv({ AUTH_SECRET: undefined });
    expect(() => assertAuthConfigured()).toThrowError(/AUTH_SECRET/);
  });

  it('getAuthEnv returns the value when configured', () => {
    setEnv({ AUTH_SECRET: 'a'.repeat(32) });
    expect(getAuthEnv()).toEqual({ AUTH_SECRET: 'a'.repeat(32) });
  });

  it('validateEnvOnBoot throws in production when keys are missing', () => {
    setEnv({ NODE_ENV: 'production', AUTH_SECRET: undefined });
    expect(() => validateEnvOnBoot()).toThrowError(/Production startup blocked/);
  });

  it('validateEnvOnBoot tolerates missing keys in development', () => {
    setEnv({ NODE_ENV: 'development', AUTH_SECRET: undefined });
    expect(() => validateEnvOnBoot()).not.toThrow();
  });

  it('validateEnvOnBoot rejects short AUTH_SECRET in production', () => {
    setEnv({
      NODE_ENV: 'production',
      AUTH_SECRET: 'changeme',
      APP_SECRET_KEY: 'a'.repeat(48),
    });
    expect(() => validateEnvOnBoot()).toThrowError(/AUTH_SECRET must be at least/);
  });

  it('validateEnvOnBoot accepts a 32+ char AUTH_SECRET in production', () => {
    setEnv({
      NODE_ENV: 'production',
      AUTH_SECRET: 'a'.repeat(32),
      APP_SECRET_KEY: 'a'.repeat(48),
    });
    expect(() => validateEnvOnBoot()).not.toThrow();
  });
});
