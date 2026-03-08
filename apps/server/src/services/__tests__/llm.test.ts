import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextLLMProvider, generateTextWithFallback } from '../llm.js';

describe('shared llm provider', () => {
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    PROMPT_OPS_LLM_PROVIDER: process.env.PROMPT_OPS_LLM_PROVIDER,
  };

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.LLM_PROVIDER = originalEnv.LLM_PROVIDER;
    process.env.PROMPT_OPS_LLM_PROVIDER = originalEnv.PROMPT_OPS_LLM_PROVIDER;
    vi.restoreAllMocks();
  });

  it('falls back to mock when no gemini key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.LLM_PROVIDER = 'auto';

    const provider = createTextLLMProvider();
    expect(provider.name).toBe('mock');

    const result = await generateTextWithFallback({
      feature: 'test',
      prompt: 'unused prompt',
      fallbackText: 'fallback output',
    });

    expect(result).toMatchObject({
      text: 'fallback output',
      provider: 'mock',
      degraded: true,
    });
  });
});
