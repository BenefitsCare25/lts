import { describe, expect, it } from 'vitest';

// Sanity check that the test runner is wired up. Replace with real
// assertions as production modules land.
describe('toolchain smoke', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
