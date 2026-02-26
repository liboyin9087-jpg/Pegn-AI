import { beforeEach, describe, expect, it, vi } from 'vitest';

const genContentSpy = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: genContentSpy,
    }),
  })),
}));

vi.mock('../db/client.js', () => ({
  pool: null,
}));

describe('PromptOpsService LLM provider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.PROMPT_OPS_LLM_PROVIDER;
  });

  it('falls back to mock provider when no gemini key exists', async () => {
    const { PromptOpsService } = await import('./prompt-ops.js');
    const service = new PromptOpsService();

    const prompt = {
      id: 'p-1',
      name: 't',
      version: '1.0.0',
      content: 'You are helpful',
      hash: 'hash',
      category: 'general',
      tags: [],
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
      is_active: true,
    };

    const result = await (service as any).runSingleTest(prompt, 'hello world');
    expect(result.actual_output).toContain('Mock response for: hello world');
    expect(result.metadata.provider).toBe('mock');
    expect(genContentSpy).not.toHaveBeenCalled();
  });

  it('uses gemini provider when explicitly enabled and key exists', async () => {
    process.env.PROMPT_OPS_LLM_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';
    genContentSpy.mockResolvedValue({
      response: { text: () => 'Gemini output' },
    });

    const { PromptOpsService } = await import('./prompt-ops.js');
    const service = new PromptOpsService();

    const prompt = {
      id: 'p-2',
      name: 't',
      version: '1.0.0',
      content: 'System prompt',
      hash: 'hash',
      category: 'general',
      tags: [],
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
      is_active: true,
    };

    const result = await (service as any).runSingleTest(prompt, 'input text');
    expect(result.actual_output).toBe('Gemini output');
    expect(result.metadata.provider).toBe('gemini');
    expect(genContentSpy).toHaveBeenCalledTimes(1);
  });
});
