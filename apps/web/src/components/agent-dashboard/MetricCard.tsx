import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface MetricCardProps {
    label: string;
    value: string | number;
    delta?: {
        value: number;
        trend: 'up' | 'down';
    };
    isLoading?: boolean;
    sparklineData?: number[]; // [0-100] values for recent history
    onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({ label, value, delta, isLoading, sparklineData, onClick }) => {
    // 渲染 Sparkline (簡易 SVG 折線圖)
    const renderSparkline = () => {
        if (!sparklineData || sparklineData.length === 0) return null;

        // 將數據標準化到 0-24px 高度
        const max = Math.max(...sparklineData, 1);
        const min = Math.min(...sparklineData, 0);
        const range = max - min;
        const height = 24;
        const width = 80;

        const points = sparklineData.map((val, i) => {
            const x = (i / (sparklineData.length - 1)) * width;
            const y = height - ((val - min) / (range || 1)) * height;
            return `${x},${y}`;
        }).join(' ');

        const isUp = delta?.trend !== 'down';
        const color = isUp ? '#4ade80' : '#f87171'; // green-400 / red-400

        return (
            <div className="absolute right-3 bottom-3 opacity-60">
                <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
                    <polyline
                        fill="none"
                        stroke={color}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={points}
                    />
                </svg>
            </div>
        );
    };

    return (
        <button
            onClick={onClick}
            disabled={isLoading || !onClick}
            className={`
        relative w-full flex-1 min-w-[140px] text-left
        bg-agent-bg-1 p-3 rounded-lg border border-agent-border-subtle
        transition-all duration-150 overflow-hidden
        ${onClick && !isLoading ? 'active:scale-[0.98] hover:border-agent-border-hover focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer' : 'cursor-default'}
      `}
            aria-label={`${label}, ${isLoading ? '載入中' : `值為 ${value}${delta ? `, 變化為 ${delta.trend === 'up' ? '上升' : '下降'} ${Math.abs(delta.value)}%` : ''}`}`}
        >
            <div className="text-[10px] uppercase tracking-wider text-agent-text-tertiary font-semibold mb-1">
                {label}
            </div>

            {isLoading ? (
                <div className="flex flex-col gap-2 mt-2">
                    <div className="h-6 bg-white/10 rounded w-16 animate-pulse" />
                </div>
            ) : (
                <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-bold tabular-nums text-agent-text-primary">
                        {value}
                    </div>
                    {delta && (
                        <div className={`flex items-center text-xs font-semibold ${delta.trend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                            {delta.trend === 'up' ? <ArrowUpRight size={12} strokeWidth={2.5} /> : <ArrowDownRight size={12} strokeWidth={2.5} />}
                            <span>{Math.abs(delta.value)}%</span>
                        </div>
                    )}
                </div>
            )}

            {!isLoading && renderSparkline()}
        </button>
    );
};
