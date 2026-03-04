import { useState, useCallback, useRef, useEffect } from 'react';
import { AgentStatus, StepItem } from './types';
import { announceStatus } from './DashboardLayout';
import { haptic } from './haptics';

export interface UseAgentStateOptions {
    initialSteps: StepItem[];
    onComplete?: () => void;
    onError?: (error: Error) => void;
}

/**
 * 核心 Hook: 處理 FSM (Finite State Machine) 邏輯
 * 實作自動計算 Token / Latency / Cost 與日誌流
 */
export function useAgentState({ initialSteps, onComplete, onError }: UseAgentStateOptions) {
    const [fsmState, setFsmState] = useState<AgentStatus>('IDLE');
    const [steps, setSteps] = useState<StepItem[]>(initialSteps);
    const [activeStepId, setActiveStepId] = useState<string | undefined>();
    const [progress, setProgress] = useState(0);

    // Metrics
    const [metrics, setMetrics] = useState({ latency: 0, cost: 0, tokens: 0 });
    const latencyTimerRef = useRef<number | null>(null);

    // 當狀態改變時，更新 Metrics 統計與 Live Regions 播報
    useEffect(() => {
        if (fsmState === 'RUNNING') {
            if (!latencyTimerRef.current) {
                // 每 100ms 更新一次延遲 (P50 mock)
                latencyTimerRef.current = window.setInterval(() => {
                    setMetrics(prev => ({ ...prev, latency: prev.latency + 0.1 }));
                }, 100);
            }
        } else {
            if (latencyTimerRef.current) {
                clearInterval(latencyTimerRef.current);
                latencyTimerRef.current = null;
            }
        }

        return () => {
            if (latencyTimerRef.current) clearInterval(latencyTimerRef.current);
        };
    }, [fsmState]);

    // 動態推算 Token 轉成本 (大約模擬: 1M tokens = $2.5) => $0.0000025 per token
    useEffect(() => {
        if (fsmState === 'COMPLETED' || fsmState === 'WAITING' || fsmState === 'ERROR') {
            const totalTokens = steps.reduce((acc, step) => acc + (step.tokens || 0), 0);
            setMetrics(prev => ({
                ...prev,
                tokens: totalTokens,
                cost: Number((totalTokens * 0.0000025).toFixed(4))
            }));
        }
    }, [steps, fsmState]);

    /**
     * Action: 更新特定步驟的狀態
     */
    const updateStep = useCallback((id: string, updates: Partial<StepItem>) => {
        setSteps(prev => prev.map(s => {
            if (s.id === id) {
                const newStep = { ...s, ...updates };
                if (updates.status === 'RUNNING') setActiveStepId(newStep.id);
                return newStep;
            }
            return s;
        }));
    }, []);

    /**
     * Action: 控制整個 FSM 狀態轉換
     */
    const transitionTo = useCallback((newState: AgentStatus, message?: string) => {
        setFsmState(newState);

        // 處理 Haptic 與 A11y
        switch (newState) {
            case 'RUNNING':
                haptic.impact('medium');
                announceStatus(message || 'Agent logic initiated', 'polite');
                break;
            case 'ERROR':
                haptic.notification('error');
                announceStatus(message || 'Agent error encountered', 'assertive');
                if (onError) onError(new Error(message));
                break;
            case 'WAITING':
                haptic.notification('warning');
                announceStatus(message || 'Agent paused, waiting for human input', 'assertive');
                break;
            case 'COMPLETED':
                haptic.notification('success');
                announceStatus(message || 'Agent task completed successfully', 'polite');
                if (onComplete) onComplete();
                break;
            case 'IDLE':
                haptic.impact('light');
                setSteps(initialSteps);
                setProgress(0);
                setMetrics({ latency: 0, cost: 0, tokens: 0 });
                break;
        }
    }, [initialSteps, onComplete, onError]);

    // 提供給外部掛上的進度控制
    const updateProgress = useCallback((val: number) => {
        if (val === 25 || val === 50 || val === 75 || val === 100) {
            announceStatus(`Workflow passes ${val}% completion`);
        }
        setProgress(Math.min(100, Math.max(0, val)));
    }, []);

    return {
        fsmState,
        steps,
        activeStepId,
        progress,
        metrics,

        // Actions
        updateStep,
        updateProgress,
        transitionTo,
        reset: () => transitionTo('IDLE'),
    };
}
