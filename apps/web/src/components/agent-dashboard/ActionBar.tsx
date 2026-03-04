import React, { useEffect, useState } from 'react';
import { AgentStatus } from './types';
import { Play, Square, RefreshCcw, X, Check, Share } from 'lucide-react';

interface ActionBarProps {
  status: AgentStatus;
  onNewRun?: () => void;
  onCancel?: () => void;
  onViewLogs?: () => void;
  onRetry?: () => void;
  onReject?: () => void;
  onApprove?: () => void;
  onShare?: () => void;
}

export const ActionBar: React.FC<ActionBarProps> = ({
  status,
  onNewRun,
  onCancel,
  onViewLogs,
  onRetry,
  onReject,
  onApprove,
  onShare
}) => {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!window?.visualViewport) return;
    const handleResize = () => {
      const vh = window.innerHeight;
      const vvh = window.visualViewport?.height || vh;
      setKeyboardHeight(Math.max(0, vh - vvh));
    };
    window.visualViewport.addEventListener('resize', handleResize);
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }, []);

  const baseClasses = "fixed left-[50%] -translate-x-1/2 w-full max-w-[448px] px-4 bg-agent-bg-2 border-t border-agent-border-subtle shadow-[0_-4px_24px_rgba(0,0,0,0.4)] transition-all duration-300 z-40";

  const renderContent = () => {
    switch (status) {
      case 'IDLE':
        return (
          <div className="py-3">
            <button onClick={onNewRun} className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white min-h-[44px] rounded-lg font-semibold transition-colors active:scale-[0.98]">
              <Play size={16} fill="currentColor" />
              新建執行
            </button>
          </div>
        );

      case 'RUNNING':
        return (
          <div className="py-3 flex gap-3">
            <button onClick={onCancel} className="flex-1 flex items-center justify-center gap-2 bg-agent-bg-3 border border-agent-border-default hover:bg-agent-bg-4 text-agent-text-primary min-h-[44px] rounded-lg font-semibold transition-colors active:scale-[0.98]">
              <Square size={16} fill="currentColor" />
              取消
            </button>
            <button onClick={onViewLogs} className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white min-h-[44px] rounded-lg font-semibold transition-colors active:scale-[0.98]">
              查看紀錄
            </button>
          </div>
        );

      case 'ERROR':
        return (
          <div className="py-3 flex gap-3">
            <button onClick={onViewLogs} className="flex-1 flex items-center justify-center bg-agent-bg-3 border border-agent-border-default hover:bg-agent-bg-4 text-agent-text-primary min-h-[44px] rounded-lg font-semibold transition-colors active:scale-[0.98]">
              查看詳情
            </button>
            <button onClick={onRetry} className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white min-h-[44px] rounded-lg font-semibold transition-colors active:scale-[0.98]">
              <RefreshCcw size={16} />
              重試
            </button>
          </div>
        );

      case 'WAITING':
        return (
          <div className="py-3 flex gap-3">
            <button onClick={onReject} className="flex-[0.3] flex items-center justify-center gap-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 min-h-[44px] rounded-lg font-semibold transition-colors active:scale-[0.98]">
              <X size={20} />
              拒絕
            </button>
            <button onClick={onApprove} className="flex-[0.7] flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white min-h-[44px] rounded-lg font-semibold focus:ring-4 focus:ring-green-500/30 transition-all active:scale-[0.98] shadow-[0_0_12px_rgba(34,197,94,0.3)]">
              <Check size={20} strokeWidth={3} />
              核准動作
            </button>
          </div>
        );

      case 'COMPLETED':
        return (
          <div className="py-3 flex gap-3">
            <button onClick={onNewRun} className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white min-h-[44px] rounded-lg font-semibold transition-colors active:scale-[0.98]">
              <Play size={16} fill="currentColor" />
              新建執行
            </button>
            <button onClick={onShare} className="w-[44px] flex items-center justify-center bg-agent-bg-3 border border-agent-border-default hover:bg-agent-bg-4 text-agent-text-primary rounded-lg transition-colors active:scale-[0.98]" aria-label="分享輸出">
              <Share size={18} />
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={baseClasses}
      style={{
        bottom: `${keyboardHeight}px`,
        paddingBottom: keyboardHeight > 0 ? '0px' : 'max(env(safe-area-inset-bottom), 12px)'
      }}
    >
      {renderContent()}
    </div>
  );
};
