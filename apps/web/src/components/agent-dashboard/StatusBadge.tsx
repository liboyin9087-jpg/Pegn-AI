import React from 'react';
import { StepStatus } from './types';
import { CheckCircle2, Clock, XCircle, AlertCircle, PlayCircle, SkipForward } from 'lucide-react';

interface StatusBadgeProps {
    status: StepStatus | 'HUMAN_INPUT';
    label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
    const getStyles = () => {
        switch (status) {
            case 'COMPLETED':
                return { bg: 'bg-green-500/15', text: 'text-green-400', icon: <CheckCircle2 size={10} /> };
            case 'FAILED':
                return { bg: 'bg-red-500/15', text: 'text-red-400', icon: <XCircle size={10} /> };
            case 'WAITING':
                return { bg: 'bg-amber-500/15', text: 'text-amber-400', icon: <AlertCircle size={10} /> };
            case 'RUNNING':
                return { bg: 'bg-blue-500/15', text: 'text-blue-400', icon: <PlayCircle size={10} className="animate-pulse" /> };
            case 'QUEUED':
                return { bg: 'bg-gray-500/15', text: 'text-gray-400', icon: <Clock size={10} /> };
            case 'SKIPPED':
                return { bg: 'bg-gray-500/15', text: 'text-gray-400', icon: <SkipForward size={10} /> };
            case 'HUMAN_INPUT':
                return { bg: 'bg-violet-500/15', text: 'text-violet-400', icon: <AlertCircle size={10} /> };
            default:
                return { bg: 'bg-gray-500/15', text: 'text-gray-400', icon: null };
        }
    };

    const styles = getStyles();
    const defaultLabels: Record<string, string> = {
        COMPLETED: '已完成',
        FAILED: '失敗',
        WAITING: '等待中',
        RUNNING: '執行中',
        QUEUED: '排隊中',
        SKIPPED: '已跳過',
        HUMAN_INPUT: '需要輸入'
    };

    return (
        <div className={`inline-flex items-center h-5 px-1.5 gap-1 text-[10px] font-semibold rounded-full ${styles.bg} ${styles.text}`}>
            {styles.icon}
            <span>{label || defaultLabels[status]}</span>
        </div>
    );
};
