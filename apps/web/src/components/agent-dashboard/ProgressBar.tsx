import React from 'react';
import { StepStatus } from './types';

interface ProgressBarProps {
    progress?: number; // 0 to 100
    status: StepStatus | 'AGENT_RUNNING';
    indeterminate?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress = 0, status, indeterminate }) => {
    const getFillStatusClass = () => {
        switch (status) {
            case 'COMPLETED':
                return 'bg-green-500';
            case 'FAILED':
                return 'bg-red-500';
            case 'WAITING':
                return 'bg-amber-500';
            case 'QUEUED':
            case 'SKIPPED':
                return 'bg-gray-500';
            case 'RUNNING':
            case 'AGENT_RUNNING':
            default:
                return 'bg-blue-500 shadow-[0_0_8px_2px_rgba(59,130,246,0.2)]';
        }
    };

    return (
        <div
            className="w-full h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
            role="progressbar"
            aria-valuenow={indeterminate ? undefined : progress}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className={`h-full rounded-full ${getFillStatusClass()} ${indeterminate ? 'w-full animate-pulse' : 'transition-all duration-300 ease-in-out'
                    }`}
                style={{ width: indeterminate ? '100%' : `${progress}%` }}
            />
        </div>
    );
};

interface SegmentedProgressBarProps {
    segments: { status: StepStatus }[];
}

export const SegmentedProgressBar: React.FC<SegmentedProgressBarProps> = ({ segments }) => {
    return (
        <div className="flex w-full gap-1" role="progressbar" aria-label="Step progress">
            {segments.map((seg, idx) => (
                <div
                    key={idx}
                    className={`flex-1 h-1.5 rounded-full ${seg.status === 'COMPLETED' ? 'bg-blue-500' : 'bg-white/[0.08]'
                        }`}
                />
            ))}
        </div>
    );
};
