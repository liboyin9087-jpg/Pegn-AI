import type { Express, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY ?? '';
const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-preview-04-17';

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

async function handleStream(req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const prompt = String(req.query.prompt ?? '').slice(0, 2000);

  if (!genAI) {
    res.write(`data: ${JSON.stringify({ token: '[錯誤] GEMINI_API_KEY 未設定' })}\n\n`);
    res.write('event: done\ndata: {}\n\n');
    res.end();
    return;
  }

  if (!prompt) {
    res.write(`data: ${JSON.stringify({ token: '[錯誤] 請提供 prompt 參數' })}\n\n`);
    res.write('event: done\ndata: {}\n\n');
    res.end();
    return;
  }

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
      }
    }

    res.write('event: done\ndata: {}\n\n');
    res.end();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.write(`data: ${JSON.stringify({ token: `[錯誤] ${msg}` })}\n\n`);
    res.write('event: done\ndata: {}\n\n');
    res.end();
  }
}

function handleRoute(req: Request, res: Response): void {
  const prompt = String(req.body?.prompt ?? '');
  const complexity = prompt.length > 160 ? 'high' : 'low';

  res.json({
    model: modelName,
    latencyTargetMs: complexity === 'high' ? 1500 : 300,
    classification: complexity,
  });
}

export function registerAiRoutes(app: Express): void {
  app.get('/api/v1/ai/stream', handleStream);
  app.post('/api/v1/ai/route', handleRoute);
}
