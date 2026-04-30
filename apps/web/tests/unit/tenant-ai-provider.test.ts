// =============================================================
// Unit tests for tenant-ai-provider helpers.
//
// Covers the URL-normalisation and deployment-detection logic that
// the router uses to build the inference URL. These were a recurring
// bug surface (project URL vs resource URL); regressions land here
// before the integration tier.
//
// The router itself is integration-tested separately (DB-backed).
// =============================================================

import {
  isClaudeDeployment,
  normalizeFoundryEndpoint,
} from '@/server/trpc/routers/tenant-ai-provider';
import { describe, expect, it } from 'vitest';

describe('normalizeFoundryEndpoint', () => {
  it('collapses a project URL to its origin', () => {
    const project = 'https://my-resource.services.ai.azure.com/api/projects/my-project';
    expect(normalizeFoundryEndpoint(project)).toBe('https://my-resource.services.ai.azure.com');
  });

  it('passes a resource URL through unchanged', () => {
    const resource = 'https://my-resource.services.ai.azure.com';
    expect(normalizeFoundryEndpoint(resource)).toBe(resource);
  });

  it('strips a trailing slash from a resource URL', () => {
    expect(normalizeFoundryEndpoint('https://my-resource.services.ai.azure.com/')).toBe(
      'https://my-resource.services.ai.azure.com',
    );
  });

  it('falls back to trim-trailing-slash for non-URL inputs', () => {
    expect(normalizeFoundryEndpoint('not-a-url///')).toBe('not-a-url');
  });
});

describe('isClaudeDeployment', () => {
  it('matches claude-* deployment names case-insensitively', () => {
    expect(isClaudeDeployment('claude-3-5-sonnet')).toBe(true);
    expect(isClaudeDeployment('Claude-Opus')).toBe(true);
    expect(isClaudeDeployment('CLAUDE_4_HAIKU')).toBe(true);
  });

  it('rejects non-Claude deployments', () => {
    expect(isClaudeDeployment('gpt-4o')).toBe(false);
    expect(isClaudeDeployment('mistral-large')).toBe(false);
    expect(isClaudeDeployment('deepseek-r1')).toBe(false);
  });

  it('does not match Claude as a substring', () => {
    expect(isClaudeDeployment('my-claude-clone')).toBe(false);
  });
});
