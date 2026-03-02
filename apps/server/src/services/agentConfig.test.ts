import { describe, expect, it } from 'vitest';
import {
  AGENT_RETRIEVAL_STRATEGY,
  decideRetrievalMode,
  getTemplateConfig,
  renderFallbackTasks,
} from './agentConfig.js';

describe('agentConfig', () => {
  it('renders fallback tasks with query interpolation', () => {
    const tasks = renderFallbackTasks('brainstorm', 'launch a community plan');
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toContain('launch a community plan');
  });

  it('provides template prompts through config lookup', () => {
    const summarize = getTemplateConfig('summarize');
    const outline = getTemplateConfig('outline');

    expect(summarize.writerPrompt.toLowerCase()).toContain('summar');
    expect(outline.writerPrompt.toLowerCase()).toContain('outline');
  });

  it('uses global threshold strategy in auto mode routing', () => {
    const highScore = decideRetrievalMode('auto', AGENT_RETRIEVAL_STRATEGY.autoHybridScoreThreshold + 0.01);
    const lowScore = decideRetrievalMode('auto', AGENT_RETRIEVAL_STRATEGY.autoHybridScoreThreshold - 0.01);

    expect(highScore.modeUsed).toBe('hybrid');
    expect(highScore.routingReason).toContain('auto_hybrid_high_score');
    expect(lowScore.modeUsed).toBe('graph');
    expect(lowScore.routingReason).toContain('auto_graph_fallback');
  });

  it('supports custom strategy override for routing', () => {
    const decision = decideRetrievalMode('auto', 0.6, {
      ...AGENT_RETRIEVAL_STRATEGY,
      autoHybridScoreThreshold: 0.7,
    });

    expect(decision.modeUsed).toBe('graph');
  });

  it('always honors forced modes', () => {
    const forceHybrid = decideRetrievalMode('hybrid', 0);
    const forceGraph = decideRetrievalMode('graph', 1);

    expect(forceHybrid).toEqual({
      modeUsed: 'hybrid',
      routingReason: 'forced_hybrid_mode',
    });
    expect(forceGraph).toEqual({
      modeUsed: 'graph',
      routingReason: 'forced_graph_mode',
    });
  });
});
