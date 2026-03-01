import React, { useState, useEffect } from 'react';
import { Activity, Bell } from 'lucide-react';
import { AgentDashboardLayout, announceStatus } from './DashboardLayout';
import { MetricCard } from './MetricCard';
import { ProgressBar } from './ProgressBar';
import { VerticalStepper, StepItem } from './VerticalStepper';
import { SwipeActionRow } from './SwipeActionRow';
import { BottomSheet } from './BottomSheet';
import { ActionBar } from './ActionBar';
import { useAgentState } from './useAgentState';
import { haptic } from './haptics';

const initialSteps: StepItem[] = [
    {
        id: '1',
        title: 'Initialize Workspace & Repository',
        status: 'QUEUED',
        content: <div className="font-mono text-xs opacity-80">Cloning user repository...<br />Setting up workspace environment...</div>
    },
    {
        id: '2',
        title: 'Analyze Dependencies & Linting',
        status: 'QUEUED',
        tokens: 4200,
        subSteps: [
            { id: '2-1', title: 'Parse package.json', status: 'QUEUED' },
            { id: '2-2', title: 'Run ESLint Analysis', status: 'QUEUED' }
        ]
    },
    {
        id: '3',
        title: 'Plan Refactoring Actions',
        status: 'QUEUED',
        tokens: 8500,
        content: <div className="font-mono text-xs text-blue-300">Generated 3 candidate AST transformations...</div>
    },
    {
        id: '4',
        title: 'User Approval Required',
        status: 'QUEUED',
        content: <div className="text-amber-300 font-semibold p-2 bg-amber-500/10 rounded">Requires human validation before executing dangerous file mutations.</div>
    },
    {
        id: '5',
        title: 'Execute File Mutations',
        status: 'QUEUED',
    }
];

export const DashboardShowcase: React.FC = () => {
    const [sheetOpen, setSheetOpen] = useState(false);

    // Inject the FSM logic via Hook
    const {
        fsmState,
        steps,
        activeStepId,
        progress,
        metrics,
        updateStep,
        updateProgress,
        transitionTo,
        reset
    } = useAgentState({ initialSteps });

    // 模擬 Agent FSM 流程
    // 由於原先在 Component 內的 setTimeout 較複雜，此處為 Showcase 目的重新簡化實作
    useEffect(() => {
        if (fsmState === 'RUNNING') {
            let active = true;
            const runFlow = async () => {
                if (!active) return;

                // Step 1
                updateProgress(10);
                updateStep('1', { status: 'RUNNING' });
                await new Promise(r => setTimeout(r, 1500));
                if (!active) return;
                updateStep('1', { status: 'COMPLETED', duration: '1.5s' });

                // Step 2 & Error Injection
                updateProgress(30);
                updateStep('2', { status: 'RUNNING' });
                await new Promise(r => setTimeout(r, 2000));
                if (!active) return;

                transitionTo('ERROR', 'Agent encountered an error during dependency analysis');
                updateStep('2', {
                    status: 'FAILED',
                    content: <div className="text-red-400 font-mono text-xs break-all">Error: Missing peer dependencies for tailwindcss@3.4.1.</div>
                });
            };

            // Reset steps before run
            if (progress === 0) runFlow();

            return () => { active = false; };
        }
    }, [fsmState, progress, transitionTo, updateProgress, updateStep]);

    const handleRetry = () => {
        transitionTo('RUNNING');
        // Fast forward to Step 3 for demo purposes
        announceStatus('Run retried. Resuming workflow from step 3', 'polite');
        setTimeout(() => {
            updateProgress(50);
            updateStep('1', { status: 'COMPLETED' });
            updateStep('2', { status: 'COMPLETED' });
            updateStep('3', { status: 'RUNNING' });

            setTimeout(() => {
                updateStep('3', { status: 'COMPLETED' });
                updateProgress(75);
                updateStep('4', { status: 'WAITING' });
                transitionTo('WAITING', 'Agent paused. Human approval required.');
            }, 2000);
        }, 500);
    };

    const handleApprove = () => {
        transitionTo('RUNNING', 'Action approved. Executing remaining tasks.');
        updateProgress(90);
        updateStep('4', { status: 'COMPLETED' });
        updateStep('5', { status: 'RUNNING' });

        setTimeout(() => {
            updateStep('5', { status: 'COMPLETED' });
            updateProgress(100);
            transitionTo('COMPLETED', 'Agent finished all tasks successfully.');
        }, 1500);
    };

    // Header 狀態色彩與 Icon
    const getHeaderStyle = () => {
        switch (fsmState) {
            case 'RUNNING': return 'border-b-blue-500/30 bg-blue-500/5';
            case 'ERROR': return 'border-b-red-500/30 bg-red-500/5';
            case 'WAITING': return 'border-b-amber-500/30 bg-amber-500/5';
            case 'COMPLETED': return 'border-b-green-500/30 bg-green-500/5';
            default: return 'border-b-agent-border-subtle';
        }
    };

    const getProgressStatus = () => {
        if (fsmState === 'ERROR') return 'FAILED';
        if (fsmState === 'WAITING') return 'WAITING';
        if (fsmState === 'COMPLETED') return 'COMPLETED';
        return 'RUNNING';
    };

    const pseudoSparkline = [20, 30, 25, 45, 60, 50, 80, 75, 95];

    return (
        <AgentDashboardLayout>
            {/* 頂部 Header & Progress */}
            <div className={`sticky top-0 z-30 backdrop-blur-md border-b transition-colors duration-500 ${getHeaderStyle()}`}>
                <div className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-md ${fsmState === 'RUNNING' ? 'bg-blue-500/20 text-blue-400' : 'bg-agent-bg-2 text-agent-text-secondary'}`}>
                            <Activity size={18} className={fsmState === 'RUNNING' ? 'animate-pulse' : ''} />
                        </div>
                        <div>
                            <h1 className="text-sm font-semibold text-agent-text-primary">功能實作</h1>
                            <div className="text-xs text-agent-text-tertiary">
                                {fsmState === 'ERROR' ? <span className="text-red-400">發生錯誤</span> :
                                    fsmState === 'WAITING' ? <span className="text-amber-400">需要核准</span> :
                                        fsmState}
                            </div>
                        </div>
                    </div>
                    <button className="text-agent-text-secondary hover:text-white relative">
                        <Bell size={18} />
                        {fsmState === 'WAITING' && <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border border-agent-bg-0" />}
                    </button>
                </div>

                {/* Global Progress Bar */}
                {(fsmState === 'RUNNING' || fsmState === 'WAITING' || fsmState === 'ERROR' || fsmState === 'COMPLETED') && (
                    <div className="h-[2px] w-full bg-agent-bg-3">
                        <ProgressBar
                            progress={progress}
                            status={getProgressStatus()}
                            indeterminate={fsmState === 'RUNNING' && progress === 0}
                        />
                    </div>
                )}
            </div>

            <div className="px-4 py-6 flex flex-col gap-6 -mb-4 border-b border-transparent">
                {/* Metrics Section */}
                <section aria-label="主要指標" className="flex gap-3 relative z-0">
                    <MetricCard
                        label="Tokens"
                        value={metrics.tokens > 0 ? (metrics.tokens / 1000).toFixed(1) + 'k' : '--'}
                        sparklineData={metrics.tokens > 0 ? pseudoSparkline : undefined}
                    />
                    <MetricCard
                        label="Latency"
                        value={metrics.latency > 0 ? `${metrics.latency.toFixed(1)}s` : '--'}
                        delta={fsmState === 'COMPLETED' ? { value: 12, trend: 'up' } : undefined}
                    />
                    <MetricCard
                        label="Cost"
                        value={metrics.cost > 0 ? `$${metrics.cost}` : '--'}
                    />
                </section>

                {/* Swipe Action Demo & Timeline */}
                <section aria-label="工作流程時間軸" className="bg-agent-bg-1 rounded-xl p-4 border border-agent-border-subtle relative z-10">
                    <h2 className="text-xs font-semibold text-agent-text-tertiary uppercase tracking-wider mb-4 border-b border-white/[0.04] pb-2">執行追蹤</h2>

                    <div className="flex flex-col gap-1 -mx-4 px-4 overflow-hidden">
                        <SwipeActionRow
                            onRetry={handleRetry}
                            onDismiss={() => reset()}
                            onApprove={fsmState === 'WAITING' ? handleApprove : undefined}
                        >
                            <VerticalStepper steps={steps} activeStepId={activeStepId} />
                        </SwipeActionRow>
                    </div>
                </section>

                {/* 為了避讓 Action Bar 的底部留白 */}
                <div className="h-24 w-full" />
            </div>

            {/* Action Bar */}
            <ActionBar
                status={fsmState}
                onNewRun={() => transitionTo('RUNNING')}
                onCancel={() => reset()}
                onRetry={handleRetry}
                onViewLogs={() => setSheetOpen(true)}
                onApprove={handleApprove}
                onReject={() => transitionTo('IDLE', '使用者拒絕')}
            />

            {/* Expanded Bottom Sheet */}
            <BottomSheet
                isOpen={sheetOpen}
                onClose={() => setSheetOpen(false)}
                title={fsmState === 'ERROR' ? "錯誤詳情" : "Agent 執行紀錄"}
                defaultTab={fsmState === 'ERROR' ? 'logs' : 'metadata'}
            >
                <div className="py-4 space-y-4">
                    {fsmState === 'ERROR' && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <h4 className="text-red-400 font-semibold text-sm mb-1">缺少設定檔</h4>
                            <p className="text-xs text-red-300">專案根目錄缺少 Babel 設定，導致 ESLint 在解析時失敗。</p>
                        </div>
                    )}
                    <div className="font-mono text-[11px] leading-relaxed text-agent-text-secondary bg-[#0a0a0a] p-4 rounded-lg border border-agent-border-subtle shadow-inner">
                        <div className="text-agent-text-tertiary mb-2"># Terminal Output</div>
                        <div className="text-blue-400">[info] Initialize Workspace</div>
                        <div>[info] Cloning user repository...</div>
                        <div className="text-green-400">[success] Workspace environment setup complete.</div>
                        <div className="text-blue-400 mt-2">[info] Parse package.json</div>
                        <div>[debug] Found 23 dependencies</div>
                        <div className="text-blue-400 mt-2">[info] Run ESLint Analysis</div>
                        {fsmState === 'ERROR' && <div className="text-red-400 font-bold">[error] Fatal: parsing error</div>}
                    </div>
                </div>
            </BottomSheet>
        </AgentDashboardLayout>
    );
};
