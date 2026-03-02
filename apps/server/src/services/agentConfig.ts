export type AgentMode = 'auto' | 'hybrid' | 'graph';
export type AgentTemplate = 'supervisor' | 'research' | 'summarize' | 'brainstorm' | 'outline';

export interface AgentTemplateDefinition {
  plannerHint: string;
  fallbackTasks: readonly string[];
  writerPrompt: string;
}

export interface AgentRetrievalStrategy {
  hybridTopK: number;
  graphTopK: number;
  autoHybridScoreThreshold: number;
  answerSourceLimit: number;
}

const TEMPLATE_DEFINITIONS: Record<AgentTemplate, AgentTemplateDefinition> = {
  supervisor: {
    plannerHint: 'General-purpose orchestration for evidence-backed answers.',
    fallbackTasks: [
      'Clarify the core intent and expected output for: {query}',
      'Collect relevant evidence, constraints, and assumptions from available sources.',
      'Synthesize an answer with decisions, rationale, and concrete next actions.',
    ],
    writerPrompt: 'Write a direct, evidence-backed response with clear rationale and practical next steps.',
  },
  research: {
    plannerHint: 'Research-focused synthesis with stronger emphasis on evidence quality.',
    fallbackTasks: [
      'Define the research scope and key sub-questions for: {query}',
      'Collect supporting and contradictory evidence from available sources.',
      'Produce findings, confidence, and unresolved gaps requiring follow-up research.',
    ],
    writerPrompt: 'Produce a concise research brief with findings, evidence quality, and open questions.',
  },
  summarize: {
    plannerHint: 'Summarization intent with compression and key-action focus.',
    fallbackTasks: [
      'Identify the main topic and target audience for: {query}',
      'Extract key facts, decisions, and outcomes that must be preserved.',
      'Deliver a compact summary with action items and risks.',
    ],
    writerPrompt: 'Summarize in concise bullets, highlighting key takeaways and action items.',
  },
  brainstorm: {
    plannerHint: 'Divergent ideation across multiple angles and constraints.',
    fallbackTasks: [
      'Generate diverse idea directions for: {query}',
      'Evaluate each direction by impact, effort, and potential risks.',
      'Select the most promising directions with concrete experiment suggestions.',
    ],
    writerPrompt: 'Provide diverse idea options, tradeoffs, and practical experiments to validate them.',
  },
  outline: {
    plannerHint: 'Structured hierarchy with logical section flow and key points.',
    fallbackTasks: [
      'Define the objective, target audience, and scope for: {query}',
      'Build a section hierarchy with logical sequencing.',
      'List key points and evidence needed per section.',
    ],
    writerPrompt: 'Produce a structured outline with clear section titles and key points per section.',
  },
};

export const AGENT_RETRIEVAL_STRATEGY: Readonly<AgentRetrievalStrategy> = Object.freeze({
  hybridTopK: 6,
  graphTopK: 6,
  autoHybridScoreThreshold: 0.45,
  answerSourceLimit: 3,
});

export function getTemplateConfig(template: AgentTemplate): AgentTemplateDefinition {
  return TEMPLATE_DEFINITIONS[template];
}

export function renderFallbackTasks(template: AgentTemplate, query: string): string[] {
  const normalizedQuery = query.trim();
  return getTemplateConfig(template).fallbackTasks.map((task) => task.replaceAll('{query}', normalizedQuery));
}

export function decideRetrievalMode(
  mode: AgentMode,
  topHybridScore: number,
  strategy: AgentRetrievalStrategy = AGENT_RETRIEVAL_STRATEGY
): { modeUsed: 'hybrid' | 'graph'; routingReason: string } {
  if (mode === 'graph') {
    return { modeUsed: 'graph', routingReason: 'forced_graph_mode' };
  }

  if (mode === 'hybrid') {
    return { modeUsed: 'hybrid', routingReason: 'forced_hybrid_mode' };
  }

  if (topHybridScore >= strategy.autoHybridScoreThreshold) {
    return {
      modeUsed: 'hybrid',
      routingReason: `auto_hybrid_high_score(${topHybridScore.toFixed(2)})`,
    };
  }

  return {
    modeUsed: 'graph',
    routingReason: `auto_graph_fallback(${topHybridScore.toFixed(2)})`,
  };
}
