export type AgentStatus = 'IDLE' | 'RUNNING' | 'ERROR' | 'WAITING' | 'COMPLETED';

export type StepStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'WAITING' | 'HUMAN_INPUT';

export interface StepItem {
    id: string;
    title: string;
    status: StepStatus;
    duration?: string;
    tokens?: number;
    content?: React.ReactNode;
    subSteps?: StepItem[]; // For nested substeps
}

export interface AgentContext {
    status: AgentStatus;
    runs: number;
    errorRate: number;
    tokensUsed: number;
    latency: number;
    cost: number;
}
