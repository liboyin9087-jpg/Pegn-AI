import type { Express, Request, Response } from 'express';
import { promptOps } from '../services/prompt-ops.js';
import { observability } from '../services/observability.js';

export function registerPromptRoutes(app: Express): void {
  // Create prompt
  app.post('/api/v1/prompts', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
      const {
        name,
        content,
        category,
        tags,
        metadata,
        created_by
      } = req.body;

      if (!name || !content || !category) {
        res.status(400).json({ 
          error: 'name, content, and category are required' 
        });
        return;
      }

      const prompt = await promptOps.createPrompt(
        name,
        content,
        category,
        tags,
        metadata,
        created_by
      );

      const duration = Date.now() - startTime;
      observability.info('Prompt created', {
        promptId: prompt.id,
        name: prompt.name,
        version: prompt.version,
        duration
      });

      res.status(201).json(prompt);
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Prompt creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      res.status(500).json({
        error: 'Failed to create prompt',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get prompt by ID
  app.get('/api/v1/prompts/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const prompt = await promptOps.getPrompt(id);
      
      if (!prompt) {
        res.status(404).json({ error: 'Prompt not found' });
        return;
      }

      res.json(prompt);
    } catch (error) {
      observability.error('Failed to get prompt', {
        error: error instanceof Error ? error.message : 'Unknown error',
        promptId: req.params.id
      });
      
      res.status(500).json({
        error: 'Failed to get prompt',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get prompt by name
  app.get('/api/v1/prompts/name/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { version } = req.query;

      const prompt = await promptOps.getPromptByName(name, version as string);
      
      if (!prompt) {
        res.status(404).json({ error: 'Prompt not found' });
        return;
      }

      res.json(prompt);
    } catch (error) {
      observability.error('Failed to get prompt by name', {
        error: error instanceof Error ? error.message : 'Unknown error',
        name: req.params.name,
        version: req.query.version
      });
      
      res.status(500).json({
        error: 'Failed to get prompt by name',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * @openapi
   * /api/v1/prompts:
   *   get:
   *     tags:
   *       - Prompts
   *     summary: 列出所有 Prompts
   *     parameters:
   *       - in: query
   *         name: category
   *         schema: { type: string }
   *         description: 依分類篩選
   *       - in: query
   *         name: tags
   *         schema: { type: string }
   *         description: 逗號分隔的標籤列表
   *     responses:
   *       '200':
   *         description: Prompt 清單
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 prompts: { type: array, items: { type: object } }
   */
  // List prompts
  app.get('/api/v1/prompts', async (req: Request, res: Response) => {
    try {
      const { category, tags } = req.query;

      // Parse tags from query string
      const tagArray = tags ? (tags as string).split(',') : undefined;

      const prompts = await promptOps.listPrompts(
        category as string,
        tagArray
      );

      res.json({ prompts });
    } catch (error) {
      observability.error('Failed to list prompts', {
        error: error instanceof Error ? error.message : 'Unknown error',
        category: req.query.category,
        tags: req.query.tags
      });
      
      res.status(500).json({
        error: 'Failed to list prompts',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update prompt
  app.put('/api/v1/prompts/:id', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
      const { id } = req.params;
      const { content, tags, metadata } = req.body;

      if (!content) {
        res.status(400).json({ 
          error: 'content is required for update' 
        });
        return;
      }

      const prompt = await promptOps.updatePrompt(id, content, tags, metadata);

      const duration = Date.now() - startTime;
      observability.info('Prompt updated', {
        promptId: prompt.id,
        version: prompt.version,
        duration
      });

      res.json(prompt);
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Prompt update failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        promptId: req.params.id
      });
      
      res.status(500).json({
        error: 'Failed to update prompt',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * @openapi
   * /api/v1/prompts/{id}/test:
   *   post:
   *     tags:
   *       - Prompts
   *     summary: 使用 LLM 執行 Prompt 測試
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [testInputs]
   *             properties:
   *               testInputs:
   *                 type: array
   *                 items: { type: object, properties: { input: { type: string } } }
   *     responses:
   *       '200':
   *         description: 測試結果陣列（含 LLM 輸出與 passed 狀態）
   *       '400':
   *         description: testInputs 格式錯誤
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   */
  // Run prompt tests
  app.post('/api/v1/prompts/:id/test', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
      const { id } = req.params;
      const { testInputs } = req.body;

      if (!Array.isArray(testInputs) || testInputs.length === 0) {
        res.status(400).json({ 
          error: 'testInputs array is required' 
        });
        return;
      }

      const testResults = await promptOps.runTests(id, testInputs);

      const duration = Date.now() - startTime;
      const passedCount = testResults.filter(t => t.passed).length;
      
      observability.info('Prompt tests completed', {
        promptId: id,
        testCount: testResults.length,
        passedCount,
        duration
      });

      res.json({
        promptId: id,
        testResults,
        summary: {
          total: testResults.length,
          passed: passedCount,
          failed: testResults.length - passedCount,
          passRate: (passedCount / testResults.length) * 100
        },
        duration
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Prompt testing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        promptId: req.params.id
      });
      
      res.status(500).json({
        error: 'Failed to run prompt tests',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get prompt categories
  app.get('/api/v1/prompts/categories', async (req: Request, res: Response) => {
    try {
      const categories = await promptOps.getCategories();
      res.json({ categories });
    } catch (error) {
      observability.error('Failed to get prompt categories', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        error: 'Failed to get prompt categories',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
