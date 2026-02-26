import React, { useState, useEffect, useCallback } from 'react';
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
import { DashboardShowcase } from './components/agent-dashboard/DashboardShowcase';
import { CollectionView } from './components/database/CollectionView';
import { useCollections, useCollectionViews } from './hooks/useCollections';
import { Collection } from './types/collection';
import {
  getToken, setToken, clearToken, getMe,
  listWorkspaces, createWorkspace,
  listDocuments, createDocument, deleteDocument, renameDocument,
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

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [aiInitPrompt, setAiInitPrompt] = useState<string | undefined>();

  // Global ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    (async () => {
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

  const { collections, addCollection } = useCollections(workspace?.id);
  const { views, addView } = useCollectionViews(activeCollection?.id);

  const handleAuth = async (authedUser: any) => {
    setUser(authedUser);
    setLoading(true);
    try { await loadWorkspace(); } finally { setLoading(false); }
  };

  const handleLogout = () => {
    clearToken();
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

      {/* Command Bar */}
      <CommandBar
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        documents={documents}
        onSelectDoc={doc => { setActiveDoc(doc); setSidebarOpen(false); }}
        onNewDoc={handleNewDoc}
        onUpload={() => setShowUpload(true)}
        onOpenAI={() => handleOpenAI()}
      />

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

        <div className="flex-1 overflow-hidden">
          <ErrorBoundary>
            {activeCollection ? (
              <CollectionView
                collection={activeCollection}
                workspaceId={workspace?.id}
                views={views}
                onUpdateView={() => { }}
              />
            ) : (
              <Editor
                doc={activeDoc}
                workspaceId={workspace?.id}
                onOpenAI={handleOpenAI}
              />
            )}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
