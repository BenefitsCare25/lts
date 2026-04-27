import {
  assertAuthConfigured,
  getAuthEnv,
  isAuthConfigured,
  validateEnvOnBoot,
} from '@/server/env';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REQUIRED = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'WORKOS_REDIRECT_URI',
] as const;

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

  it('isAuthConfigured returns false when any required key is missing', () => {
    setEnv({
      WORKOS_API_KEY: 'sk_test',
      WORKOS_CLIENT_ID: 'client_test',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(40),
      WORKOS_REDIRECT_URI: undefined,
    });
    expect(isAuthConfigured()).toBe(false);
  });

  it('isAuthConfigured returns true only when all required keys are present', () => {
    setEnv({
      WORKOS_API_KEY: 'sk_test',
      WORKOS_CLIENT_ID: 'client_test',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(40),
      WORKOS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    });
    expect(isAuthConfigured()).toBe(true);
  });

  it('treats empty strings the same as undefined', () => {
    setEnv({
      WORKOS_API_KEY: '',
      WORKOS_CLIENT_ID: 'client_test',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(40),
      WORKOS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    });
    expect(isAuthConfigured()).toBe(false);
  });

  it('assertAuthConfigured throws with the missing keys when not configured', () => {
    setEnv({
      WORKOS_API_KEY: undefined,
      WORKOS_CLIENT_ID: 'client_test',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(40),
      WORKOS_REDIRECT_URI: undefined,
    });
    expect(() => assertAuthConfigured()).toThrowError(/WORKOS_API_KEY.*WORKOS_REDIRECT_URI/);
  });

  it('getAuthEnv returns the values when configured', () => {
    setEnv({
      WORKOS_API_KEY: 'sk_test',
      WORKOS_CLIENT_ID: 'client_test',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(40),
      WORKOS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    });
    expect(getAuthEnv()).toEqual({
      WORKOS_API_KEY: 'sk_test',
      WORKOS_CLIENT_ID: 'client_test',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(40),
      WORKOS_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    });
  });

  it('validateEnvOnBoot throws in production when keys are missing', () => {
    setEnv({
      NODE_ENV: 'production',
      WORKOS_API_KEY: undefined,
      WORKOS_CLIENT_ID: undefined,
      WORKOS_COOKIE_PASSWORD: undefined,
      WORKOS_REDIRECT_URI: undefined,
    });
    expect(() => validateEnvOnBoot()).toThrowError(/Production startup blocked/);
  });

  it('validateEnvOnBoot tolerates missing keys in development', () => {
    setEnv({
      NODE_ENV: 'development',
      WORKOS_API_KEY: undefined,
      WORKOS_CLIENT_ID: undefined,
      WORKOS_COOKIE_PASSWORD: undefined,
      WORKOS_REDIRECT_URI: undefined,
    });
    expect(() => validateEnvOnBoot()).not.toThrow();
  });
});
