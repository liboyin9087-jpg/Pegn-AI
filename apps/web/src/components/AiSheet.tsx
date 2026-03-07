import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, MessageSquare, Search, Bot, GitFork, Zap, Sparkles, Shield } from 'lucide-react';
import GraphRAGChat from './GraphRAGChat';
import SearchPanel from './SearchPanel';
import AgentPanel from './AgentPanel';
import KGPanel from './KGPanel';
import AutomationPanel from './AutomationPanel';
import OperationsPanel from './OperationsPanel';
import AdminTrustPanel from './AdminTrustPanel';
import { useOptionalAppContext, useWorkspacePermissions } from '../contexts/AppContext';
import type { JobType, SavedViewSurface, SurfaceLinkTarget } from '../api/client';
import PinnedViewsBar from './PinnedViewsBar';
import SavedViewPicker from './SavedViewPicker';
import SaveCurrentViewDialog from './SaveCurrentViewDialog';

type Tab = 'chat' | 'search' | 'agent' | 'kg' | 'automation' | 'operations' | 'admin';

const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'agent', icon: Bot, label: 'Agent' },
  { id: 'kg', icon: GitFork, label: 'Graph' },
  { id: 'automation', icon: Zap, label: 'Automation' },
  { id: 'operations', icon: Sparkles, label: 'Ops' },
  { id: 'admin', icon: Shield, label: 'Admin' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
  activeDoc?: any;
  onNavigateDoc?: (id: string) => void;
  defaultTab?: Tab;
  initialPrompt?: string;
  navigationTarget?: SurfaceLinkTarget | null;
  onOpenSurfaceTarget?: (target: SurfaceLinkTarget) => void;
}

export default function AiSheet({
  open,
  onClose,
  workspaceId,
  activeDoc,
  onNavigateDoc,
  defaultTab = 'chat',
  navigationTarget,
  onOpenSurfaceTarget,
}: Props) {
  const appContext = useOptionalAppContext();
  const workspacePermissions = useWorkspacePermissions();
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [operationsType, setOperationsType] = useState<'all' | JobType>('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savedViewsRefreshNonce, setSavedViewsRefreshNonce] = useState(0);

  const activeSavedViewSurface: SavedViewSurface | null =
    tab === 'search' || tab === 'operations' || tab === 'agent' || tab === 'admin'
      ? tab
      : null;

  const openOperations = (options?: { jobId?: string | null; jobType?: 'all' | JobType }) => {
    setSelectedJobId(options?.jobId ?? null);
    setOperationsType(options?.jobType ?? 'all');
    setTab('operations');
  };

  useEffect(() => {
    if (!navigationTarget) return;
    switch (navigationTarget.surface) {
      case 'search':
        setTab('search');
        return;
      case 'agent':
        setTab('agent');
        return;
      case 'operations':
        setSelectedJobId(navigationTarget.payload.jobId ?? null);
        setOperationsType(navigationTarget.payload.jobType ?? 'all');
        setTab('operations');
        return;
      case 'admin':
        if (workspacePermissions.canManageSettings) {
          setTab('admin');
        }
        return;
      case 'document':
        if (navigationTarget.payload.documentId && onNavigateDoc) {
          onNavigateDoc(navigationTarget.payload.documentId);
          onClose();
        }
        return;
      case 'inbox':
        return;
      default:
        return;
    }
  }, [navigationTarget, onClose, onNavigateDoc, workspacePermissions.canManageSettings]);

  const visibleTabs = workspacePermissions.canManageSettings
    ? TABS
    : TABS.filter((nextTab) => nextTab.id !== 'admin');

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-30 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.2)' }}
            onClick={onClose}
          />

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
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>AI Workspace</span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: '#a0a0ae' }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = '#f4f5f7';
                  event.currentTarget.style.color = '#1a1a2e';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'transparent';
                  event.currentTarget.style.color = '#a0a0ae';
                }}
              >
                <X size={15} />
              </button>
            </div>

            <PinnedViewsBar
              workspaceId={workspaceId}
              refreshNonce={savedViewsRefreshNonce}
              onApplyView={(view) => appContext?.applySavedView?.(view)}
            />

            <div
              className="flex flex-shrink-0 px-4 gap-1"
              style={{ paddingTop: 10, paddingBottom: 10, borderBottom: '1px solid #e8e8ea' }}
            >
              {visibleTabs.map((nextTab) => (
                <button
                  key={nextTab.id}
                  onClick={() => setTab(nextTab.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-150"
                  style={{
                    fontSize: 12,
                    fontWeight: tab === nextTab.id ? 500 : 400,
                    color: tab === nextTab.id ? '#2383e2' : '#6b6b7a',
                    background: tab === nextTab.id ? '#ebf2fc' : 'transparent',
                  }}
                >
                  <nextTab.icon size={13} />
                  {nextTab.label}
                </button>
              ))}
              {activeSavedViewSurface ? (
                <div className="ml-auto relative flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSaveDialogOpen(false);
                      setPickerOpen((current) => !current);
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary"
                  >
                    Views
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPickerOpen(false);
                      setSaveDialogOpen((current) => !current);
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary"
                  >
                    Save
                  </button>
                  <SavedViewPicker
                    open={pickerOpen}
                    workspaceId={workspaceId}
                    surface={activeSavedViewSurface}
                    onClose={() => setPickerOpen(false)}
                    onApplyView={(view) => {
                      appContext?.applySavedView?.(view);
                    }}
                  />
                  <SaveCurrentViewDialog
                    open={saveDialogOpen}
                    workspaceId={workspaceId}
                    surface={activeSavedViewSurface}
                    payload={appContext?.captureCurrentSurfaceContext?.(activeSavedViewSurface) ?? null}
                    onClose={() => setSaveDialogOpen(false)}
                    onSaved={() => setSavedViewsRefreshNonce((current) => current + 1)}
                  />
                </div>
              ) : null}
            </div>

            <div className="relative flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 overflow-y-auto"
                >
                  {tab === 'chat' && workspaceId ? <GraphRAGChat workspaceId={workspaceId} activeDoc={activeDoc} /> : null}
                  {tab === 'search' && workspaceId ? (
                    <SearchPanel
                      workspaceId={workspaceId}
                      onNavigateDoc={onNavigateDoc}
                      onOpenOperations={() => openOperations({ jobType: 'document_reindex' })}
                      navigationTarget={navigationTarget?.surface === 'search' ? navigationTarget : null}
                      onOpenSurfaceTarget={onOpenSurfaceTarget}
                    />
                  ) : null}
                  {tab === 'agent' && workspaceId ? (
                    <AgentPanel
                      workspaceId={workspaceId}
                      activeDoc={activeDoc}
                      onOpenJob={(jobId) => openOperations({ jobId, jobType: 'agent_run' })}
                      navigationTarget={navigationTarget?.surface === 'agent' ? navigationTarget : null}
                      onOpenSurfaceTarget={onOpenSurfaceTarget}
                    />
                  ) : null}
                  {tab === 'kg' && workspaceId ? <KGPanel workspaceId={workspaceId} activeDoc={activeDoc} /> : null}
                  {tab === 'automation' && workspaceId ? (
                    <AutomationPanel
                      workspaceId={workspaceId}
                      onOpenJob={(jobId) => openOperations({ jobId, jobType: 'automation_trigger' })}
                    />
                  ) : null}
                  {tab === 'operations' && workspaceId ? (
                    <OperationsPanel
                      workspaceId={workspaceId}
                      selectedJobId={selectedJobId}
                      initialJobType={operationsType}
                      navigationTarget={navigationTarget?.surface === 'operations' ? navigationTarget : null}
                      onOpenSurfaceTarget={onOpenSurfaceTarget}
                    />
                  ) : null}
                  {tab === 'admin' && workspaceId ? (
                    <AdminTrustPanel
                      workspaceId={workspaceId}
                      onOpenOperations={() => openOperations({ jobType: 'all' })}
                      onOpenSearch={() => setTab('search')}
                      navigationTarget={navigationTarget?.surface === 'admin' ? navigationTarget : null}
                      onOpenSurfaceTarget={onOpenSurfaceTarget}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
