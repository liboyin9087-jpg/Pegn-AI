import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Search, Bot, GitFork, X } from 'lucide-react';
import GraphRAGChat from './GraphRAGChat';
import SearchPanel from './SearchPanel';
import AgentPanel from './AgentPanel';
import KGPanel from './KGPanel';

interface Props {
  workspaceId: string;
  activeDoc: any;
  tab: 'chat' | 'search' | 'agent' | 'kg';
  onTabChange: (t: any) => void;
  onNavigateDoc?: (docId: string) => void;
  onClose?: () => void;
  isMobile?: boolean;
}

const TABS = [
  { id: 'chat',   label: 'Chat',   Icon: MessageSquare },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'agent',  label: 'Agent',  Icon: Bot },
  { id: 'kg',     label: 'Graph',  Icon: GitFork },
] as const;

export default function AiPanel({ workspaceId, activeDoc, tab, onTabChange, onNavigateDoc, onClose, isMobile }: Props) {
  return (
    <aside className="flex flex-col h-full bg-white" style={{ borderLeft: '1px solid #e8e8ea' }}>
      {/* Tab header */}
      <div
        className="flex items-center flex-shrink-0 px-3 gap-0.5"
        style={{ height: 48, borderBottom: '1px solid #e8e8ea' }}
      >
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-150"
            style={{
              fontSize:   12,
              fontWeight: tab === t.id ? 500 : 400,
              color:      tab === t.id ? '#2383e2' : '#6b6b7a',
              background: tab === t.id ? '#ebf2fc'  : 'transparent',
            }}
          >
            <t.Icon size={13} />
            {t.label}
          </button>
        ))}

        {(isMobile || onClose) && (
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg transition-colors"
            style={{ color: '#6b6b7a' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f4f5f7')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Animated content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="h-full"
          >
            {tab === 'chat'   && <GraphRAGChat workspaceId={workspaceId} activeDoc={activeDoc} />}
            {tab === 'search' && <SearchPanel  workspaceId={workspaceId} onNavigateDoc={onNavigateDoc} />}
            {tab === 'agent'  && <AgentPanel   workspaceId={workspaceId} activeDoc={activeDoc} />}
            {tab === 'kg'     && <KGPanel      workspaceId={workspaceId} activeDoc={activeDoc} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </aside>
  );
}
