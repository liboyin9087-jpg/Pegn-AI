import crypto from 'node:crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { observability } from './observability.js';

export interface Prompt {
  id: string;
  name: string;
  version: string;
  content: string;
  hash: string;
  category: string;
  tags: string[];
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  is_active: boolean;
}

export interface PromptTest {
  id: string;
  prompt_id: string;
  input: string;
  expected_output?: string;
  actual_output?: string;
  score?: number;
  passed: boolean;
  created_at: Date;
  metadata: Record<string, any>;
}

export interface PromptRegression {
  id: string;
  prompt_id: string;
  old_hash: string;
  new_hash: string;
  test_results: PromptTest[];
  regression_detected: boolean;
  created_at: Date;
}

interface LLMProvider {
  readonly name: string;
  generate(prompt: string, input: string): Promise<string>;
}

class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';

  async generate(_prompt: string, input: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return `Mock response for: ${input}`;
  }
}

class GeminiLLMProvider implements LLMProvider {
  readonly name = 'gemini';
  private client: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  async generate(prompt: string, input: string): Promise<string> {
    const model = this.client.getGenerativeModel({ model: this.modelName });
    const result = await model.generateContent(`${prompt}\n\nInput:\n${input}`);
    return result.response.text();
  }
}

export class PromptOpsService {
  private prompts: Map<string, Prompt> = new Map();
  private tests: Map<string, PromptTest[]> = new Map();
  private llmProvider: LLMProvider;

  constructor() {
    this.llmProvider = this.createLLMProvider();
    this.initializeDatabase();
  }

  private createLLMProvider(): LLMProvider {
    const preferred = String(process.env.PROMPT_OPS_LLM_PROVIDER ?? 'auto').toLowerCase();
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

    if ((preferred === 'gemini' || preferred === 'auto') && apiKey) {
      observability.info('PromptOps LLM provider initialized', { provider: 'gemini', modelName });
      return new GeminiLLMProvider(apiKey, modelName);
    }

    if (preferred === 'gemini' && !apiKey) {
      observability.warn('PromptOps provider fallback to mock due to missing GEMINI_API_KEY', { preferred });
    }

    observability.info('PromptOps LLM provider initialized', { provider: 'mock' });
    return new MockLLMProvider();
  }

  private async initializeDatabase(): Promise<void> {
    if (!pool) return;

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS prompts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          content TEXT NOT NULL,
          hash TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL,
          tags TEXT[] DEFAULT '{}',
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_by UUID,
          is_active BOOLEAN DEFAULT true
        );

        CREATE TABLE IF NOT EXISTS prompt_tests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
          input TEXT NOT NULL,
          expected_output TEXT,
          actual_output TEXT,
          score DECIMAL(3,2),
          passed BOOLEAN NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          metadata JSONB DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS prompt_regressions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
          old_hash TEXT NOT NULL,
          new_hash TEXT NOT NULL,
          test_results JSONB NOT NULL,
          regression_detected BOOLEAN NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_prompts_hash ON prompts(hash);
        CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name);
        CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
        CREATE INDEX IF NOT EXISTS idx_prompt_tests_prompt_id ON prompt_tests(prompt_id);
        CREATE INDEX IF NOT EXISTS idx_prompt_regressions_prompt_id ON prompt_regressions(prompt_id);
      `);

      observability.info('PromptOps database initialized');
    } catch (error) {
      observability.error('Failed to initialize PromptOps database', { error });
    }
  }

  // Prompt management
  async createPrompt(
    name: string,
    content: string,
    category: string,
    tags: string[] = [],
    metadata: Record<string, any> = {},
    createdBy?: string
  ): Promise<Prompt> {
    const hash = this.generateHash(content);
    const version = await this.getNextVersion(name);

    const prompt: Prompt = {
      id: crypto.randomUUID(),
      name,
      version,
      content,
      hash,
      category,
      tags,
      metadata,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: createdBy,
      is_active: true
    };

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO prompts (id, name, version, content, hash, category, tags, metadata, created_by, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            prompt.id,
            prompt.name,
            prompt.version,
            prompt.content,
            prompt.hash,
            prompt.category,
            prompt.tags,
            prompt.metadata,
            prompt.created_by,
            prompt.is_active
          ]
        );

        observability.info('Prompt created', { name, version, hash });
      } catch (error) {
        observability.error('Failed to create prompt', { name, error });
        throw error;
      }
    }

    this.prompts.set(prompt.id, prompt);
    return prompt;
  }

  async updatePrompt(
    id: string,
    content: string,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<Prompt> {
    const existingPrompt = await this.getPrompt(id);
    if (!existingPrompt) {
      throw new Error(`Prompt with id ${id} not found`);
    }

    const oldHash = existingPrompt.hash;
    const newHash = this.generateHash(content);

    if (oldHash === newHash) {
      observability.info('Prompt content unchanged', { id, hash: oldHash });
      return existingPrompt;
    }

    // Check for regressions before updating
    const regressionDetected = await this.checkForRegression(id, oldHash, newHash);

    const updatedPrompt: Prompt = {
      ...existingPrompt,
      content,
      hash: newHash,
      version: await this.getNextVersion(existingPrompt.name),
      tags: tags || existingPrompt.tags,
      metadata: metadata || existingPrompt.metadata,
      updated_at: new Date()
    };

    if (pool) {
      try {
        await pool.query(
          `UPDATE prompts 
           SET content = $1, hash = $2, version = $3, tags = $4, metadata = $5, updated_at = NOW()
           WHERE id = $6`,
          [updatedPrompt.content, updatedPrompt.hash, updatedPrompt.version, updatedPrompt.tags, updatedPrompt.metadata, id]
        );

        // Record regression if detected
        if (regressionDetected) {
          await this.recordRegression(id, oldHash, newHash);
        }

        observability.info('Prompt updated', { 
          id, 
          oldHash, 
          newHash, 
          version: updatedPrompt.version,
          regressionDetected 
        });
      } catch (error) {
        observability.error('Failed to update prompt', { id, error });
        throw error;
      }
    }

    this.prompts.set(id, updatedPrompt);
    return updatedPrompt;
  }

  async getPrompt(id: string): Promise<Prompt | null> {
    // Check cache first
    if (this.prompts.has(id)) {
      return this.prompts.get(id)!;
    }

    if (!pool) return null;

    try {
      const result = await pool.query('SELECT * FROM prompts WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;

      const prompt = this.mapRowToPrompt(result.rows[0]);
      this.prompts.set(id, prompt);
      return prompt;
    } catch (error) {
      observability.error('Failed to get prompt', { id, error });
      return null;
    }
  }

  async getPromptByName(name: string, version?: string): Promise<Prompt | null> {
    if (!pool) return null;

    try {
      let query = 'SELECT * FROM prompts WHERE name = $1';
      const params = [name];

      if (version) {
        query += ' AND version = $2';
        params.push(version);
      } else {
        query += ' AND is_active = true ORDER BY version DESC LIMIT 1';
      }

      const result = await pool.query(query, params);
      if (result.rows.length === 0) return null;

      return this.mapRowToPrompt(result.rows[0]);
    } catch (error) {
      observability.error('Failed to get prompt by name', { name, version, error });
      return null;
    }
  }

  async listPrompts(category?: string, tags?: string[]): Promise<Prompt[]> {
    if (!pool) return [];

    try {
      let query = 'SELECT * FROM prompts WHERE is_active = true';
      const params: any[] = [];

      if (category) {
        query += ' AND category = $1';
        params.push(category);
      }

      if (tags && tags.length > 0) {
        query += ' AND tags && $' + (params.length + 1);
        params.push(tags);
      }

      query += ' ORDER BY updated_at DESC';

      const result = await pool.query(query, params);
      return result.rows.map(row => this.mapRowToPrompt(row));
    } catch (error) {
      observability.error('Failed to list prompts', { category, tags, error });
      return [];
    }
  }

  async getCategories(): Promise<string[]> {
    if (!pool) return [];
    try {
      const result = await pool.query(
        `SELECT DISTINCT category FROM prompts WHERE is_active = true ORDER BY category`
      );
      return result.rows.map((r: any) => r.category);
    } catch (error) {
      observability.error('Failed to get prompt categories', { error });
      return [];
    }
  }

  // Testing
  async runTests(promptId: string, testInputs: string[]): Promise<PromptTest[]> {
    const prompt = await this.getPrompt(promptId);
    if (!prompt) {
      throw new Error(`Prompt with id ${promptId} not found`);
    }

    const tests: PromptTest[] = [];

    for (const input of testInputs) {
      const test = await this.runSingleTest(prompt, input);
      tests.push(test);
    }

    // Store tests
    if (pool) {
      try {
        for (const test of tests) {
          await pool.query(
            `INSERT INTO prompt_tests (id, prompt_id, input, expected_output, actual_output, score, passed, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              test.id,
              test.prompt_id,
              test.input,
              test.expected_output,
              test.actual_output,
              test.score,
              test.passed,
              test.metadata
            ]
          );
        }
      } catch (error) {
        observability.error('Failed to store test results', { promptId, error });
      }
    }

    observability.info('Tests completed', { promptId, testCount: tests.length, passed: tests.filter(t => t.passed).length });
    return tests;
  }

  private async runSingleTest(prompt: Prompt, input: string): Promise<PromptTest> {
    const startTime = Date.now();
    
    try {
      const actualOutput = await this.runLLMCall(prompt.content, input);
      const score = await this.calculateScore(input, actualOutput);
      const passed = score >= 0.7; // 70% threshold

      return {
        id: crypto.randomUUID(),
        prompt_id: prompt.id,
        input,
        actual_output: actualOutput,
        score,
        passed,
        created_at: new Date(),
        metadata: {
          duration: Date.now() - startTime,
          prompt_version: prompt.version,
          provider: this.llmProvider.name
        }
      };
    } catch (error) {
      return {
        id: crypto.randomUUID(),
        prompt_id: prompt.id,
        input,
        passed: false,
        created_at: new Date(),
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
          duration: Date.now() - startTime
        }
      };
    }
  }

  private async runLLMCall(prompt: string, input: string): Promise<string> {
    observability.debug('PromptOps LLM call', {
      provider: this.llmProvider.name,
      prompt: prompt.substring(0, 100),
      input: input.substring(0, 100)
    });

    return this.llmProvider.generate(prompt, input);
  }

  private async calculateScore(input: string, output: string): Promise<number> {
    // Simple scoring algorithm - in production, use more sophisticated methods
    if (!output || output.trim().length === 0) return 0;
    
    // Basic checks
    let score = 0.5; // Base score
    
    if (output.length > 10) score += 0.2;
    if (output.toLowerCase().includes(input.toLowerCase().split(' ')[0])) score += 0.2;
    if (output.length < input.length * 5) score += 0.1; // Not too verbose
    
    return Math.min(score, 1.0);
  }

  private async checkForRegression(promptId: string, oldHash: string, newHash: string): Promise<boolean> {
    // Get recent tests for the old version
    if (!pool) return false;

    try {
      const result = await pool.query(
        `SELECT * FROM prompt_tests 
         WHERE prompt_id = $1 
         ORDER BY created_at DESC 
         LIMIT 10`,
        [promptId]
      );

      if (result.rows.length === 0) return false;

      // Run tests with new version and compare
      const testInputs = result.rows.map(row => row.input);
      const newTests = await this.runTests(promptId, testInputs);
      
      const oldAvgScore = result.rows.reduce((acc: number, row: any) => acc + (row.score || 0), 0) / result.rows.length;
      const newAvgScore = newTests.reduce((acc, test) => acc + (test.score || 0), 0) / newTests.length;
      
      // Regression detected if score drops by more than 20%
      const regressionDetected = (oldAvgScore - newAvgScore) > 0.2;
      
      observability.info('Regression check completed', {
        promptId,
        oldAvgScore,
        newAvgScore,
        regressionDetected
      });

      return regressionDetected;
    } catch (error) {
      observability.error('Failed to check for regression', { promptId, error });
      return false;
    }
  }

  private async recordRegression(promptId: string, oldHash: string, newHash: string): Promise<void> {
    if (!pool) return;

    try {
      await pool.query(
        `INSERT INTO prompt_regressions (id, prompt_id, old_hash, new_hash, test_results, regression_detected)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          promptId,
          oldHash,
          newHash,
          JSON.stringify([]), // Would include actual test results
          true
        ]
      );

      observability.warn('Regression recorded', { promptId, oldHash, newHash });
    } catch (error) {
      observability.error('Failed to record regression', { promptId, error });
    }
  }

  // Utility methods
  private generateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async getNextVersion(name: string): Promise<string> {
    if (!pool) return '1.0.0';

    try {
      const result = await pool.query(
        'SELECT version FROM prompts WHERE name = $1 ORDER BY version DESC LIMIT 1',
        [name]
      );

      if (result.rows.length === 0) return '1.0.0';

      const lastVersion = result.rows[0].version;
      const parts = lastVersion.split('.').map(Number);
      parts[2]++; // Increment patch version
      
      return parts.join('.');
    } catch (error) {
      observability.error('Failed to get next version', { name, error });
      return '1.0.0';
    }
  }

  private mapRowToPrompt(row: any): Prompt {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      content: row.content,
      hash: row.hash,
      category: row.category,
      tags: row.tags || [],
      metadata: row.metadata || {},
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      is_active: row.is_active
    };
  }
}

export const promptOps = new PromptOpsService();
