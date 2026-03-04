import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, FileCode, CheckCircle2 } from 'lucide-react';
import { StepStatus } from './types';
import { StatusBadge } from './StatusBadge';

export interface StepItem {
    id: string;
    title: string;
    status: StepStatus;
    duration?: string;
    tokens?: number;
    content?: React.ReactNode;
    subSteps?: StepItem[]; // added nested support
}

interface StepProps {
    step: StepItem;
    index: number;
    isLast: boolean;
    isActive: boolean;
    isNested?: boolean;
}

export const VerticalStep: React.FC<StepProps> = ({ step, index, isLast, isActive, isNested = false }) => {
    const [isExpanded, setIsExpanded] = useState(isActive);
    const contentRef = useRef<HTMLDivElement>(null);

    // 當狀態轉為 Active (RUNNING/ERROR/WAITING) 時自動展開
    useEffect(() => {
        if (isActive) {
            setIsExpanded(true);
        }
    }, [isActive]);

    const getStatusIndicator = () => {
        if (isNested) {
            if (step.status === 'COMPLETED') return <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />;
            if (step.status === 'RUNNING') return <div className="w-3 h-3 rounded-full border border-blue-500 border-t-transparent animate-spin flex-shrink-0" />;
            return <div className="w-3 h-3 rounded-full border border-agent-text-disabled flex-shrink-0" />;
        }

        switch (step.status) {
            case 'COMPLETED':
                return <div className="w-4 h-4 rounded-full bg-green-500/20 border border-green-500 flex items-center justify-center relative z-10"><div className="w-2 h-2 rounded-full bg-green-500" /></div>;
            case 'RUNNING':
                return <div className="w-4 h-4 rounded-full bg-blue-500/20 border border-blue-500 flex items-center justify-center relative z-10 animate-pulse"><div className="w-2 h-2 rounded-full bg-blue-500" /></div>;
            case 'FAILED':
                return <div className="w-4 h-4 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center relative z-10"><div className="w-1.5 h-1.5 rounded-sm bg-red-500" /></div>;
            case 'WAITING':
                return <div className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500 flex items-center justify-center relative z-10"><div className="w-2 h-2 rounded-full bg-amber-500" /></div>;
            case 'QUEUED':
            case 'SKIPPED':
            default:
                return <div className="w-4 h-4 rounded-full overflow-hidden bg-agent-bg-2 border border-agent-border-default flex items-center justify-center relative z-10"><div className="w-1.5 h-1.5 rounded-full bg-agent-text-disabled" /></div>;
        }
    };

    const isLineActive = step.status === 'COMPLETED' || step.status === 'RUNNING';
    const hasContent = step.content || (step.subSteps && step.subSteps.length > 0);

    return (
        <li
            className={`relative flex flex-col group ${isNested ? 'mt-3' : ''}`}
            aria-current={isActive ? 'step' : undefined}
        >
            <span className="sr-only">status is {step.status}</span>

            {/* 垂直連線 (Connector) */}
            {!isLast && !isNested && (
                <div
                    className={`absolute left-[7px] top-6 bottom-[-8px] w-[2px] -ml-[1px] ${isLineActive ? 'bg-blue-500' : 'bg-white/[0.08]'
                        } transition-colors duration-300`}
                    aria-hidden="true"
                />
            )}

            {/* Header 行 (Tappable Area) */}
            <button
                onClick={() => hasContent && setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
                aria-controls={`step-${step.id}-details`}
                disabled={!hasContent}
                className={`
          flex items-start text-left w-full ${isNested ? 'min-h-[24px]' : 'min-h-[44px]'} py-1.5 px-0 gap-3
          transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 rounded-sm
          ${isActive ? 'opacity-100' : 'opacity-80 hover:opacity-100'}
          ${!hasContent ? 'cursor-default' : 'cursor-pointer'}
        `}
            >
                <div className={isNested ? "pt-1" : "pt-1"}>{getStatusIndicator()}</div>

                <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center justify-between">
                        <span className={`font-semibold truncate ${isNested ? 'text-xs tabular-nums text-agent-text-secondary' : 'text-sm'} ${step.status === 'FAILED' ? 'text-red-400' : 'text-agent-text-primary'}`}>
                            {step.title}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {step.duration && <span className="text-xs text-agent-text-tertiary tabular-nums">{step.duration}</span>}
                            {hasContent && !isNested && (
                                <ChevronDown
                                    size={16}
                                    className={`text-agent-text-tertiary transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                                />
                            )}
                        </div>
                    </div>

                    {/* Micro metrics - 只有收合時顯示最重要的資訊 */}
                    {!isExpanded && !isNested && (step.tokens || step.status !== 'QUEUED') && (
                        <div className="flex items-center gap-2 mt-0.5">
                            <StatusBadge status={step.status === 'RUNNING' ? 'RUNNING' : step.status} />
                            {step.tokens && <span className="text-[10px] text-agent-text-tertiary tabular-nums">{step.tokens} tokens</span>}
                        </div>
                    )}
                </div>
            </button>

            {/* Expanded Content (Accordion) */}
            {hasContent && (
                <div
                    id={`step-${step.id}-details`}
                    role="region"
                    className={`
          overflow-hidden transition-all duration-300 ease-in-out
          ${isNested ? 'pl-6' : 'pl-7 pr-4'}
          ${step.status === 'FAILED' && !isNested ? 'border-l-2 border-l-red-500/50 -ml-[1px]' : ''}
        `}
                    style={{
                        maxHeight: isExpanded ? (contentRef.current?.scrollHeight || 1000) : 0,
                        opacity: isExpanded ? 1 : 0,
                        visibility: isExpanded ? 'visible' : 'hidden',
                        marginBottom: isExpanded ? (isNested ? 4 : 16) : 0,
                    }}
                    ref={contentRef}
                >
                    <div className={`pt-2 ${isNested ? 'pb-0' : 'pb-1'} text-sm text-agent-text-secondary`}>
                        {step.subSteps && step.subSteps.length > 0 ? (
                            <ul className="list-none p-0 m-0 border-l border-white/10 pl-3 ml-1">
                                {step.subSteps.map((subItem, idx) => (
                                    <VerticalStep
                                        key={subItem.id}
                                        step={subItem}
                                        index={idx}
                                        isLast={idx === step.subSteps!.length - 1}
                                        isActive={isActive && subItem.status === 'RUNNING'}
                                        isNested={true}
                                    />
                                ))}
                            </ul>
                        ) : step.content ? (
                            step.content
                        ) : null}
                    </div>
                </div>
            )}
        </li>
    );
};

interface VerticalStepperProps {
    steps: StepItem[];
    activeStepId?: string;
}

export const VerticalStepper: React.FC<VerticalStepperProps> = ({ steps, activeStepId }) => {
    return (
        <nav aria-label="Agent workflow progress" className="w-full">
            <ol role="list" className="w-full p-0 m-0 list-none">
                {steps.map((step, index) => (
                    <VerticalStep
                        key={step.id}
                        step={step}
                        index={index}
                        isLast={index === steps.length - 1}
                        isActive={step.id === activeStepId}
                    />
                ))}
            </ol>
        </nav>
    );
};
