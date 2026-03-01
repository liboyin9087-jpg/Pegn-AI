import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PanelLeft, Sparkles } from 'lucide-react';
import AuthPage from './components/AuthPage';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import AiSheet from './components/AiSheet';
import CommandBar from './components/CommandBar';
import OnboardingModal from './components/OnboardingModal';
import UploadModal from './components/UploadModal';
import ErrorBoundary from './components/ErrorBoundary';
import InboxPanel from './components/InboxPanel';
import PageHeader from './components/PageHeader';
import { DashboardShowcase } from './components/agent-dashboard/DashboardShowcase';
import { CollectionView } from './components/database/CollectionView';
import { useCollections, useCollectionViews } from './hooks/useCollections';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import KeyboardHelpModal from './components/KeyboardHelpModal';
import { Collection } from './types/collection';
import {
  getToken, setToken, clearToken, getMe, setOfflineRolloutUserId,
  listWorkspaces, createWorkspace,
  listDocuments, createDocument, deleteDocument, renameDocument,
  updateDocument, moveDocument,
  acceptInvite,
  listInboxNotifications, markInboxNotificationRead, markAllInboxNotificationsRead, reportOfflineQueueMetrics,
  getOfflineQueueDepth, onOfflineQueueChange, replayQueuedMutations,
  type InboxNotification, type OfflineQueueMetricsSource,
} from './api/client';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [workspace, setWorkspace] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeDoc, setActiveDoc] = useState<any>(null);
  const [activeCollection, setActiveCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxNotifications, setInboxNotifications] = useState<InboxNotification[]>([]);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [offlineQueueDepth, setOfflineQueueDepth] = useState(0);
  const queueDepthReportTimerRef = useRef<number | null>(null);
  const lastIntervalDepthRef = useRef<number | null>(null);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiInitPrompt, setAiInitPrompt] = useState<string | undefined>();

  // Global keyboard shortcuts (⌘K, ⌘N, ⌘/, ⌘⇧A, ?)
  // Use lambdas to avoid temporal dead zone when handleNewDoc is declared later.
  useKeyboardShortcuts({
    onOpenCommand: () => setCmdOpen(o => !o),
    onNewDoc: () => handleNewDoc(),
    onToggleSidebar: () => setSidebarOpen(o => !o),
    onToggleAI: () => setAiSheetOpen(o => !o),
    onShowHelp: () => setHelpOpen(o => !o),
  });

  useEffect(() => {
    (async () => {
      const inviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/);
      if (inviteMatch?.[1]) {
        sessionStorage.setItem('pending_invite_token', inviteMatch[1]);
        window.history.replaceState(null, '', '/');
      }

      // Handle OAuth callback — token arrives in URL hash
      const hash = window.location.hash;
      if (hash.startsWith('#token=')) {
        const params = new URLSearchParams(hash.slice(1));
        const token = params.get('token');
        const oauthError = params.get('error');
        // Clear hash from URL
        window.history.replaceState(null, '', window.location.pathname);
        if (token) {
          setToken(token);
        } else if (oauthError) {
          setAuthChecked(true);
          setLoading(false);
          return;
        }
      }

      if (!getToken()) { setAuthChecked(true); setLoading(false); return; }
      try {
        const { user: me } = await getMe();
        setUser(me);
        setOfflineRolloutUserId(me?.id ?? me?.user_id ?? null);
        const pendingInviteToken = sessionStorage.getItem('pending_invite_token');
        if (pendingInviteToken) {
          try {
            await acceptInvite(pendingInviteToken);
            sessionStorage.removeItem('pending_invite_token');
          } catch (error) {
            console.error('Failed to accept invite:', error);
          }
        }
        await loadWorkspace();
      } catch {
        clearToken();
      } finally {
        setAuthChecked(true);
        setLoading(false);
      }
    })();
  }, []);

  const loadWorkspace = async () => {
    const { workspaces } = await listWorkspaces() as any;
    let ws = workspaces[0];
    const isNew = !ws;
    if (isNew) ws = await createWorkspace('My Workspace');
    setWorkspace(ws);
    const { documents: docs } = await listDocuments(ws.id) as any;
    setDocuments(docs || []);
    if (docs?.length > 0) setActiveDoc(docs[0]);
    if (isNew) setShowOnboarding(true);
  };

  const refreshInbox = useCallback(async (status: 'unread' | 'all' = 'all') => {
    setInboxLoading(true);
    try {
      const { notifications, unread_count } = await listInboxNotifications(status);
      setInboxNotifications(notifications);
      setInboxUnreadCount(unread_count);
    } catch (error) {
      console.error('Failed to load inbox', error);
    } finally {
      setInboxLoading(false);
    }
  }, []);

  const { collections, addCollection } = useCollections(workspace?.id);
  const { views, addView } = useCollectionViews(activeCollection?.id);

  const reportQueueObservability = useCallback(async (payload: {
    queue_depth: number;
    replay_processed?: number;
    replay_failed?: number;
    source: OfflineQueueMetricsSource;
  }) => {
    if (!workspace?.id) return;
    try {
      await reportOfflineQueueMetrics({
        workspace_id: workspace.id,
        queue_depth: payload.queue_depth,
        replay_processed: payload.replay_processed,
        replay_failed: payload.replay_failed,
        source: payload.source,
      });
    } catch (error) {
      console.warn('Failed to report offline queue observability', error);
    }
  }, [workspace?.id]);

  const handleAuth = async (authedUser: any) => {
    setUser(authedUser);
    setOfflineRolloutUserId(authedUser?.id ?? authedUser?.user_id ?? null);
    setLoading(true);
    try {
      const pendingInviteToken = sessionStorage.getItem('pending_invite_token');
      if (pendingInviteToken) {
        try {
          await acceptInvite(pendingInviteToken);
          sessionStorage.removeItem('pending_invite_token');
        } catch (error) {
          console.error('Failed to accept invite:', error);
        }
      }
      await loadWorkspace();
      await refreshInbox('all');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    setOfflineRolloutUserId(null);
    setUser(null); setWorkspace(null); setDocuments([]); setActiveDoc(null);
  };

  const handleNewDoc = async (parentId?: string) => {
    if (!workspace) return;
    const doc = await createDocument(workspace.id, `Untitled ${documents.length + 1}`, parentId);
    setDocuments(prev => [doc, ...prev]);
    setActiveDoc(doc);
  };

  const handleDeleteDoc = async (id: string) => {
    if (!confirm('確定要刪除這份文件嗎？')) return;
    try {
      await deleteDocument(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
      if (activeDoc?.id === id) {
        const remaining = documents.filter(d => d.id !== id);
        setActiveDoc(remaining[0] ?? null);
      }
    } catch (err) { alert(`刪除失敗：${err instanceof Error ? err.message : '請稍後再試'}`); }
  };

  const handleRenameDoc = async (id: string, title: string) => {
    try {
      await renameDocument(id, title);
      setDocuments(prev => prev.map(d => d.id === id ? { ...d, title } : d));
      if (activeDoc?.id === id) setActiveDoc((prev: any) => ({ ...prev, title }));
    } catch (err) { alert(`重命名失敗：${err instanceof Error ? err.message : '請稍後再試'}`); }
  };

  const handleUploaded = (doc: any) => {
    setDocuments(prev => [doc, ...prev]);
    setActiveDoc(doc);
    setShowUpload(false);
  };

  const handleNavigateDoc = (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    if (doc) {
      setActiveDoc(doc);
      setActiveCollection(null);
    }
  };

  const handleMarkNotificationRead = useCallback(async (notificationId: string) => {
    try {
      await markInboxNotificationRead(notificationId);
      setInboxNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, status: 'read', read_at: new Date().toISOString() } : n));
      setInboxUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification as read', error);
    }
  }, []);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    try {
      await markAllInboxNotificationsRead();
      setInboxNotifications(prev => prev.map(n => ({ ...n, status: 'read', read_at: n.read_at ?? new Date().toISOString() })));
      setInboxUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all notifications as read', error);
    }
  }, []);

  const handleOpenNotification = useCallback(async (notification: InboxNotification) => {
    if (notification.status === 'unread') {
      await handleMarkNotificationRead(notification.id);
    }
    const documentId = notification.payload?.document_id;
    const threadId = notification.payload?.thread_id;
    if (documentId) {
      const nextDoc = documents.find(d => d.id === documentId);
      if (nextDoc) {
        setActiveDoc(nextDoc);
        setActiveCollection(null);
      }
    }
    if (threadId) {
      setFocusThreadId(threadId);
    }
    setInboxOpen(false);
  }, [documents, handleMarkNotificationRead]);

  useEffect(() => {
    if (!user) return;
    refreshInbox('all');
  }, [user?.id, workspace?.id, refreshInbox]);

  useEffect(() => {
    if (!user?.id || !workspace?.id) return;
    let active = true;

    (async () => {
      const replayResult = navigator.onLine
        ? await replayQueuedMutations()
        : { processed: 0, failed: 0, processed_ids: [], failed_ids: [] };
      const depth = await getOfflineQueueDepth();
      if (active) setOfflineQueueDepth(depth);
      await reportQueueObservability({
        queue_depth: depth,
        replay_processed: replayResult.processed,
        replay_failed: replayResult.failed,
        source: 'bootstrap',
      });
      lastIntervalDepthRef.current = depth;
    })();

    const unsubscribeQueue = onOfflineQueueChange((depth) => {
      if (!active) return;
      setOfflineQueueDepth(depth);
      if (queueDepthReportTimerRef.current) {
        window.clearTimeout(queueDepthReportTimerRef.current);
      }
      queueDepthReportTimerRef.current = window.setTimeout(() => {
        if (!active) return;
        void reportQueueObservability({
          queue_depth: depth,
          source: 'queue_changed',
        });
        lastIntervalDepthRef.current = depth;
      }, 1000);
    });

    const handleOnline = async () => {
      setIsOnline(true);
      const replayResult = await replayQueuedMutations();
      const depth = await getOfflineQueueDepth();
      if (active) setOfflineQueueDepth(depth);
      await reportQueueObservability({
        queue_depth: depth,
        replay_processed: replayResult.processed,
        replay_failed: replayResult.failed,
        source: 'online',
      });
      lastIntervalDepthRef.current = depth;
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = window.setInterval(async () => {
      if (!navigator.onLine) return;
      const replayResult = await replayQueuedMutations();
      const depth = await getOfflineQueueDepth();
      if (active) setOfflineQueueDepth(depth);
      const depthChanged = lastIntervalDepthRef.current !== depth;
      const hasReplayResult = (replayResult.processed + replayResult.failed) > 0;
      if (!depthChanged && !hasReplayResult) return;
      await reportQueueObservability({
        queue_depth: depth,
        replay_processed: replayResult.processed,
        replay_failed: replayResult.failed,
        source: 'interval',
      });
      lastIntervalDepthRef.current = depth;
    }, 30000);

    return () => {
      active = false;
      if (queueDepthReportTimerRef.current) {
        window.clearTimeout(queueDepthReportTimerRef.current);
        queueDepthReportTimerRef.current = null;
      }
      unsubscribeQueue();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(interval);
    };
  }, [reportQueueObservability, user?.id, workspace?.id]);

  const handleSelectDoc = (doc: any) => {
    setActiveDoc(doc);
    setActiveCollection(null);
  };

  const handleSelectCollection = (col: Collection) => {
    setActiveCollection(col);
    setActiveDoc(null);
  };

  const handleNewCollection = async () => {
    if (!workspace) return;
    const name = prompt('請輸入資料庫名稱', '新建資料庫');
    if (name) {
      const col = await addCollection(name);
      if (col) {
        // Automatically create a default table view
        setActiveCollection(col);
        setActiveDoc(null);
      }
    }
  };

  const handleMoveDoc = useCallback(async (id: string, data: { parent_id: string | null; position: number }) => {
    try {
      await moveDocument(id, data);
      setDocuments(prev => prev.map(d =>
        d.id === id
          ? { ...d, metadata: { ...(d.metadata ?? {}), parent_id: data.parent_id }, position: data.position }
          : d
      ));
    } catch (err) {
      console.error('Failed to move document', err);
    }
  }, []);

  const handleUpdateDocMeta = useCallback(async (id: string, meta: Record<string, any>) => {
    try {
      const doc = documents.find(d => d.id === id);
      if (!doc) return;
      const newMeta = { ...(doc.metadata ?? {}), ...meta };
      await updateDocument(id, { metadata: newMeta });
      setDocuments(prev => prev.map(d => d.id === id ? { ...d, metadata: newMeta } : d));
      if (activeDoc?.id === id) setActiveDoc((prev: any) => ({ ...prev, metadata: newMeta }));
    } catch (err) {
      console.error('Failed to update document metadata', err);
    }
  }, [documents, activeDoc]);

  // Compute ancestor path for breadcrumb
  const getAncestors = useCallback((docId: string): { id: string; title: string; icon?: string }[] => {
    const result: { id: string; title: string; icon?: string }[] = [];
    let current = documents.find(d => d.id === docId);
    const visited = new Set<string>();
    while (current) {
      const parentId = current.metadata?.parent_id;
      if (!parentId || visited.has(parentId)) break;
      visited.add(parentId);
      const parent = documents.find(d => d.id === parentId);
      if (!parent) break;
      result.unshift({ id: parent.id, title: parent.title, icon: parent.metadata?.icon });
      current = parent;
    }
    return result;
  }, [documents]);

  const handleOpenAI = useCallback((prompt?: string) => {
    setAiInitPrompt(prompt);
    setAiSheetOpen(true);
  }, []);

  if (!authChecked || loading) return (
    <div className="flex items-center justify-center h-screen bg-surface">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-text-tertiary text-sm">載入中...</p>
      </div>
    </div>
  );

  if (!user) return <AuthPage onAuth={handleAuth} />;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'white' }}>
      {/* Modals */}
      {showOnboarding && (
        <OnboardingModal
          workspaceId={workspace?.id}
          onComplete={() => setShowOnboarding(false)}
        />
      )}
      {showUpload && workspace && (
        <UploadModal
          workspaceId={workspace.id}
          onClose={() => setShowUpload(false)}
          onUploaded={handleUploaded}
        />
      )}
      <InboxPanel
        open={inboxOpen}
        loading={inboxLoading}
        notifications={inboxNotifications}
        unreadCount={inboxUnreadCount}
        onClose={() => setInboxOpen(false)}
        onOpenNotification={handleOpenNotification}
        onMarkRead={handleMarkNotificationRead}
        onMarkAllRead={handleMarkAllNotificationsRead}
      />

      {/* Command Bar */}
      <CommandBar
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        documents={documents}
        onSelectDoc={doc => { setActiveDoc(doc); setSidebarOpen(false); }}
        onNewDoc={handleNewDoc}
        onUpload={() => setShowUpload(true)}
        onOpenAI={() => handleOpenAI()}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
        onShowShortcuts={() => { setCmdOpen(false); setHelpOpen(true); }}
      />

      {/* Keyboard Help Modal */}
      <KeyboardHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* AI Side Sheet */}
      <ErrorBoundary>
        <AiSheet
          open={aiSheetOpen}
          onClose={() => { setAiSheetOpen(false); setAiInitPrompt(undefined); }}
          workspaceId={workspace?.id}
          activeDoc={activeDoc}
          onNavigateDoc={handleNavigateDoc}
          initialPrompt={aiInitPrompt}
        />
      </ErrorBoundary>

      {/* Sidebar */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            key="sidebar"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 240, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex-shrink-0 overflow-hidden"
            style={{ height: '100%' }}
          >
            <ErrorBoundary>
              <Sidebar
                workspace={workspace}
                documents={documents}
                collections={collections}
                activeDoc={activeDoc}
                activeCollection={activeCollection}
                user={user}
                onSelectDoc={handleSelectDoc}
                onSelectCollection={handleSelectCollection}
                onNewDoc={handleNewDoc}
                onNewCollection={handleNewCollection}
                onUpload={() => setShowUpload(true)}
                onDeleteDoc={handleDeleteDoc}
                onRenameDoc={handleRenameDoc}
                onMoveDoc={handleMoveDoc}
                inboxUnreadCount={inboxUnreadCount}
                onOpenInbox={() => {
                  setInboxOpen(true);
                  refreshInbox('all');
                }}
                onLogout={handleLogout}
                onOpenCommand={() => setCmdOpen(true)}
              />
            </ErrorBoundary>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div
          className="flex items-center justify-between px-3 flex-shrink-0"
          style={{ height: 44, borderBottom: '1px solid #e8e8ea', background: 'white' }}
        >
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: '#6b6b7a' }}
              title={sidebarOpen ? '收合側欄' : '展開側欄'}
              onMouseEnter={e => { e.currentTarget.style.background = '#f4f5f7'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <PanelLeft size={16} />
            </button>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1" style={{ fontSize: 13, color: '#a0a0ae' }}>
              <span>{workspace?.name ?? 'My Workspace'}</span>
              {activeDoc && (
                <>
                  <span>/</span>
                  <span style={{ color: '#37352f', fontWeight: 450 }}>{activeDoc.title}</span>
                </>
              )}
              {activeCollection && (
                <>
                  <span>/</span>
                  <span style={{ color: '#37352f', fontWeight: 450 }}>{activeCollection.name}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <div
              className="text-[11px] px-2 py-1 rounded-md"
              style={{
                background: isOnline ? '#eef9f1' : '#fff4e5',
                color: isOnline ? '#1e7a3b' : '#b26a00',
              }}
            >
              {isOnline ? 'Online' : 'Offline'} · 待同步 {offlineQueueDepth}
            </div>
            {!showOnboarding && (
              <button
                onClick={() => setShowOnboarding(true)}
                className="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                style={{ color: '#a0a0ae' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f4f5f7'; e.currentTarget.style.color = '#6b6b7a'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a0a0ae'; }}
              >說明</button>
            )}
            <button
              onClick={() => handleOpenAI()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white transition-opacity"
              style={{
                fontSize: 12, fontWeight: 500,
                background: 'linear-gradient(135deg, #2383e2, #7c3aed)',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              <Sparkles size={12} />
              AI
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <ErrorBoundary>
            {activeCollection ? (
              <CollectionView
                collection={activeCollection}
                workspaceId={workspace?.id}
                views={views}
                collections={collections}
                onUpdateView={() => { }}
                onUpdateCollection={updated => setActiveCollection(updated)}
                onOpenFullPage={rowId => {
                  const doc = documents.find((d: any) => d.id === rowId);
                  if (doc) { setActiveDoc(doc); setActiveCollection(null); }
                }}
              />
            ) : (
              <div className="flex flex-col h-full overflow-y-auto">
                <PageHeader
                  doc={activeDoc}
                  ancestors={activeDoc ? getAncestors(activeDoc.id) : []}
                  onChangeIcon={icon => activeDoc && handleUpdateDocMeta(activeDoc.id, { icon })}
                  onChangeCover={cover => activeDoc && handleUpdateDocMeta(activeDoc.id, { cover })}
                  onChangeTitle={title => activeDoc && handleRenameDoc(activeDoc.id, title)}
                  onNavigate={handleNavigateDoc}
                />
                <div className="flex-1">
                  <Editor
                    doc={activeDoc}
                    workspaceId={workspace?.id}
                    onOpenAI={handleOpenAI}
                    focusThreadId={focusThreadId}
                    onFocusThreadHandled={() => setFocusThreadId(null)}
                    documents={documents}
                    onNavigateDoc={handleNavigateDoc}
                    user={user ? { id: user.id, name: user.name, email: user.email } : undefined}
                  />
                </div>
              </div>
            )}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
