import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, MessageSquare, Search, Bot, GitFork, Sparkles } from 'lucide-react';
import GraphRAGChat from './GraphRAGChat';
import SearchPanel from './SearchPanel';
import AgentPanel from './AgentPanel';
import KGPanel from './KGPanel';

type Tab = 'chat' | 'search' | 'agent' | 'kg';

const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
  { id: 'chat',   icon: MessageSquare, label: '對話'   },
  { id: 'search', icon: Search,        label: '搜尋'   },
  { id: 'agent',  icon: Bot,           label: 'Agent'  },
  { id: 'kg',     icon: GitFork,       label: '知識圖' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
  activeDoc?: any;
  onNavigateDoc?: (id: string) => void;
  defaultTab?: Tab;
  initialPrompt?: string;
}

export default function AiSheet({ open, onClose, workspaceId, activeDoc, onNavigateDoc, defaultTab = 'chat', initialPrompt }: Props) {
  const [tab, setTab] = useState<Tab>(defaultTab);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — only on narrow screens */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-30 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.2)' }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="fixed right-0 top-0 bottom-0 z-40 flex flex-col"
            style={{
              width: 380,
              maxWidth: '90vw',
              background: 'white',
              borderLeft: '1px solid #e8e8ea',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.06)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 flex-shrink-0"
              style={{ height: 52, borderBottom: '1px solid #e8e8ea' }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #2383e2, #7c3aed)' }}
                >
                  <Sparkles size={13} color="white" />
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>AI 助手</span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: '#a0a0ae' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f4f5f7'; e.currentTarget.style.color = '#1a1a2e'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a0a0ae'; }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Tabs */}
            <div
              className="flex flex-shrink-0 px-4 gap-1"
              style={{ paddingTop: 10, paddingBottom: 10, borderBottom: '1px solid #e8e8ea' }}
            >
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-150"
                  style={{
                    fontSize: 12,
                    fontWeight: tab === t.id ? 500 : 400,
                    color:      tab === t.id ? '#2383e2' : '#6b6b7a',
                    background: tab === t.id ? '#ebf2fc'  : 'transparent',
                  }}
                >
                  <t.icon size={13} />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 overflow-y-auto"
                >
                  {tab === 'chat'   && workspaceId && <GraphRAGChat workspaceId={workspaceId} activeDoc={activeDoc} />}
                  {tab === 'search' && workspaceId && <SearchPanel  workspaceId={workspaceId} onNavigateDoc={onNavigateDoc} />}
                  {tab === 'agent'  && workspaceId && <AgentPanel   workspaceId={workspaceId} activeDoc={activeDoc} />}
                  {tab === 'kg'     && workspaceId && <KGPanel      workspaceId={workspaceId} activeDoc={activeDoc} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
