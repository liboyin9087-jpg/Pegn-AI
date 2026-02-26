import React, { useEffect, useState } from 'react';

/**
 * 宣告全局 a11y 廣播區域，用於螢幕閱讀器狀態播報
 * 根據規範，需要兩個 announcer:
 * 1. polite: 用於進度更新、步驟完成
 * 2. assertive: 用於錯誤、需要人工介入的緊急通知
 */
export const A11yAnnouncer = () => {
    return (
        <>
            <div className="sr-only" aria-live="polite" aria-atomic="true" id="status-announcer"></div>
            <div className="sr-only" aria-live="assertive" aria-atomic="true" id="alert-announcer"></div>
        </>
    );
};

export const announceStatus = (message: string, type: 'polite' | 'assertive' = 'polite') => {
    const el = document.getElementById(type === 'polite' ? 'status-announcer' : 'alert-announcer');
    if (el) {
        el.textContent = message;
    }
};

interface AgentLayoutProps {
    children: React.ReactNode;
}

export const AgentDashboardLayout: React.FC<AgentLayoutProps> = ({ children }) => {
    // 強制套用深色模式背景與 448px 寬度限制
    return (
        <div className="bg-agent-bg-0 text-agent-text-primary min-h-screen font-sans antialiased selection:bg-blue-500/30">
            <A11yAnnouncer />
            <div className="mx-auto max-w-[448px] w-full min-h-screen border-x border-agent-border-subtle shadow-2xl relative overflow-x-hidden pt-safe pb-safe">
                {children}
            </div>
        </div>
    );
};
