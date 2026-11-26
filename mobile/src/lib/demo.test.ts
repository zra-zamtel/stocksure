import { afterEach, describe, expect, it, vi } from 'vitest';

describe('UT-DEMO sample-data tools (QA-06)', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_DEMO_TOOLS;
    vi.resetModules();
  });

  it('UT-DEMO-01 are off in a normal release build', async () => {
    const { DEMO_TOOLS } = await import('./demo');
    expect(DEMO_TOOLS).toBe(false);
  });

  it('UT-DEMO-02 turn on only when the build is made with the demo flag', async () => {
    process.env.EXPO_PUBLIC_DEMO_TOOLS = '1';
    const { DEMO_TOOLS } = await import('./demo');
    expect(DEMO_TOOLS).toBe(true);
  });

  it('UT-DEMO-03 ignore any other value of the flag', async () => {
    process.env.EXPO_PUBLIC_DEMO_TOOLS = 'true';
    const { DEMO_TOOLS } = await import('./demo');
    expect(DEMO_TOOLS).toBe(false);
  });
});
