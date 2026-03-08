import { GoogleGenerativeAI } from '@google/generative-ai';
import { observability } from './observability.js';

export interface TextLLMProvider {
  readonly name: string;
  generate(prompt: string): Promise<string>;
  stream?(prompt: string): AsyncIterable<string>;
}

export interface TextGenerationResult {
  text: string;
  provider: string;
  degraded: boolean;
  reason?: string;
}

class MockTextLLMProvider implements TextLLMProvider {
  readonly name = 'mock';

  async generate(prompt: string): Promise<string> {
    return prompt;
  }

  async *stream(prompt: string): AsyncIterable<string> {
    yield prompt;
  }
}

class GeminiTextLLMProvider implements TextLLMProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly modelName: string,
  ) {}

  private createModel() {
    const client = new GoogleGenerativeAI(this.apiKey);
    return client.getGenerativeModel({ model: this.modelName });
  }

  async generate(prompt: string): Promise<string> {
    const result = await this.createModel().generateContent(prompt);
    return result.response.text();
  }

  async *stream(prompt: string): AsyncIterable<string> {
    const result = await this.createModel().generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }
}

function getProviderPreference() {
  return String(process.env.LLM_PROVIDER ?? process.env.PROMPT_OPS_LLM_PROVIDER ?? 'auto').toLowerCase();
}

export function createTextLLMProvider(): TextLLMProvider {
  const preferred = getProviderPreference();
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  if ((preferred === 'auto' || preferred === 'gemini') && apiKey) {
    return new GeminiTextLLMProvider(apiKey, modelName);
  }

  return new MockTextLLMProvider();
}

export async function generateTextWithFallback(params: {
  feature: string;
  prompt: string;
  fallbackText: string;
  onError?: (error: unknown) => void;
}): Promise<TextGenerationResult> {
  const provider = createTextLLMProvider();

  if (provider.name === 'mock') {
    observability.warn('LLM degraded to mock provider', {
      feature: params.feature,
      reason: process.env.GEMINI_API_KEY ? 'provider_forced_mock' : 'missing_gemini_key',
    });
    observability.recordMetric('llm_degraded_total', 1, {
      feature: params.feature,
      provider: provider.name,
    });
    return {
      text: params.fallbackText,
      provider: provider.name,
      degraded: true,
      reason: process.env.GEMINI_API_KEY ? 'provider_forced_mock' : 'missing_gemini_key',
    };
  }

  try {
    const text = await provider.generate(params.prompt);
    return {
      text,
      provider: provider.name,
      degraded: false,
    };
  } catch (error) {
    params.onError?.(error);
    observability.warn('LLM generation failed, returning fallback output', {
      feature: params.feature,
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    observability.recordMetric('llm_degraded_total', 1, {
      feature: params.feature,
      provider: provider.name,
    });
    return {
      text: params.fallbackText,
      provider: provider.name,
      degraded: true,
      reason: 'provider_error',
    };
  }
}

export async function streamTextWithFallback(params: {
  feature: string;
  prompt: string;
  fallbackText: string;
  onToken?: (token: string) => void;
  onError?: (error: unknown) => void;
}): Promise<TextGenerationResult> {
  const provider = createTextLLMProvider();

  if (!provider.stream || provider.name === 'mock') {
    observability.warn('LLM streaming degraded to fallback output', {
      feature: params.feature,
      provider: provider.name,
      reason: process.env.GEMINI_API_KEY ? 'stream_unavailable' : 'missing_gemini_key',
    });
    observability.recordMetric('llm_degraded_total', 1, {
      feature: params.feature,
      provider: provider.name,
    });
    params.onToken?.(params.fallbackText);
    return {
      text: params.fallbackText,
      provider: provider.name,
      degraded: true,
      reason: process.env.GEMINI_API_KEY ? 'stream_unavailable' : 'missing_gemini_key',
    };
  }

  try {
    let output = '';
    for await (const token of provider.stream(params.prompt)) {
      output += token;
      params.onToken?.(token);
    }
    return {
      text: output,
      provider: provider.name,
      degraded: false,
    };
  } catch (error) {
    params.onError?.(error);
    observability.warn('LLM stream failed, returning fallback output', {
      feature: params.feature,
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    observability.recordMetric('llm_degraded_total', 1, {
      feature: params.feature,
      provider: provider.name,
    });
    params.onToken?.(params.fallbackText);
    return {
      text: params.fallbackText,
      provider: provider.name,
      degraded: true,
      reason: 'provider_error',
    };
  }
}
