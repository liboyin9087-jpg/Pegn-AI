import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Plus, MoreHorizontal, Edit2, Trash2, Upload,
  LogOut, Search, ChevronRight, FilePlus, Database, LayoutGrid
} from 'lucide-react';
import { Collection } from '../types/collection';

interface Doc { id: string; title: string; metadata?: any; }

interface TreeNode extends Doc {
  children: TreeNode[];
  depth: number;
}

interface Props {
  workspace: any;
  documents: Doc[];
  collections?: Collection[];
  activeDoc: any;
  activeCollection?: Collection | null;
  user: any;
  onSelectDoc: (doc: Doc) => void;
  onSelectCollection: (col: Collection) => void;
  onNewDoc: (parentId?: string) => void;
  onNewCollection: () => void;
  onUpload: () => void;
  onDeleteDoc: (id: string) => void;
  onRenameDoc: (id: string, title: string) => void;
  onLogout: () => void;
  onClose?: () => void;
  onOpenCommand?: () => void;
}

function buildTree(docs: Doc[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const d of docs) map.set(d.id, { ...d, children: [], depth: 0 });
  for (const d of docs) {
    const node = map.get(d.id)!;
    const parentId = d.metadata?.parent_id;
    if (parentId && map.has(parentId)) {
      const parent = map.get(parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ── Tree node ──────────────────────────────────────────────────────────────
function DocTreeNode({
  node, activeDoc, expandedIds, menuDocId, renamingId, renameVal, renameRef,
  onToggleExpand, onSelectDoc, onStartRename, onSubmitRename, onSetRenameVal,
  onDeleteDoc, onNewChild, onSetMenuDocId, onClose,
}: {
  node: TreeNode;
  activeDoc: any;
  expandedIds: Set<string>;
  menuDocId: string | null;
  renamingId: string | null;
  renameVal: string;
  renameRef: React.RefObject<HTMLInputElement | null>;
  onToggleExpand: (id: string) => void;
  onSelectDoc: (doc: Doc) => void;
  onStartRename: (doc: Doc) => void;
  onSubmitRename: (id: string) => void;
  onSetRenameVal: (v: string) => void;
  onDeleteDoc: (id: string) => void;
  onNewChild: (parentId: string) => void;
  onSetMenuDocId: (id: string | null) => void;
  onClose?: () => void;
}) {
  const isActive = activeDoc?.id === node.id;
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const indent = node.depth * 14;

  return (
    <div>
      <div className="relative group" onClick={e => e.stopPropagation()}>
        {renamingId === node.id ? (
          <div
            className="mx-1 px-2 py-1 rounded-md"
            style={{ marginLeft: `${4 + indent}px`, background: 'var(--color-accent-light)' }}
          >
            <input
              ref={renameRef as React.RefObject<HTMLInputElement>}
              value={renameVal}
              onChange={e => onSetRenameVal(e.target.value)}
              onBlur={() => onSubmitRename(node.id)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSubmitRename(node.id);
                if (e.key === 'Escape') onSetMenuDocId(null);
              }}
              className="w-full outline-none px-1.5 py-0.5 rounded"
              style={{
                fontSize: 13,
                background: 'white',
                border: '1.5px solid var(--color-accent)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => { onSelectDoc(node); onClose?.(); }}
            className="w-full flex items-center gap-1 rounded-md text-left transition-colors"
            style={{
              paddingLeft: `${6 + indent}px`,
              paddingRight: 6,
              paddingTop: 5,
              paddingBottom: 5,
              margin: '1px 4px',
              width: 'calc(100% - 8px)',
              background: isActive ? 'var(--color-accent-light)' : 'transparent',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--color-panel-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'var(--color-accent-light)' : 'transparent'; }}
          >
            <span
              className="flex-shrink-0 flex items-center justify-center rounded transition-colors"
              style={{ width: 16, height: 16, color: hasChildren ? 'var(--color-text-quaternary)' : 'transparent', cursor: hasChildren ? 'pointer' : 'default' }}
              onClick={e => { e.stopPropagation(); if (hasChildren) onToggleExpand(node.id); }}
            >
              {hasChildren && (
                <motion.span
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  style={{ display: 'flex' }}
                >
                  <ChevronRight size={11} />
                </motion.span>
              )}
            </span>

            <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0, userSelect: 'none' }}>
              {node.metadata?.source === 'upload' ? '📄' : (node.metadata?.icon ?? '📝')}
            </span>

            <span
              className="flex-1 truncate"
              style={{
                fontSize: 13,
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                fontWeight: isActive ? 500 : 400,
                marginLeft: 4,
              }}
            >
              {node.title}
            </span>

            <span className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity flex-shrink-0">
              <span
                role="button"
                onClick={e => { e.stopPropagation(); onNewChild(node.id); }}
                className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                style={{ color: 'var(--color-text-tertiary)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-tertiary)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
                title="新增子頁面"
              >
                <Plus size={11} />
              </span>
              <span
                role="button"
                onClick={e => { e.stopPropagation(); onSetMenuDocId(menuDocId === node.id ? null : node.id); }}
                className="w-5 h-5 flex items-center justify-center rounded transition-colors"
                style={{ color: 'var(--color-text-tertiary)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-tertiary)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
              >
                <MoreHorizontal size={11} />
              </span>
            </span>
          </button>
        )}

        <AnimatePresence>
          {menuDocId === node.id && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-2 z-50 py-1 rounded-xl"
              style={{
                top: '100%',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-lg)',
                minWidth: 168,
              }}
              onClick={e => e.stopPropagation()}
            >
              <MenuButton icon={<FilePlus size={12} />} label="新增子頁面" onClick={() => { onNewChild(node.id); onSetMenuDocId(null); }} />
              <MenuButton icon={<Edit2 size={12} />} label="重命名" onClick={() => { onStartRename(node); onSetMenuDocId(null); }} />
              <div style={{ margin: '3px 10px', borderTop: '1px solid var(--color-border)' }} />
              <MenuButton icon={<Trash2 size={12} />} label="刪除" onClick={() => { onDeleteDoc(node.id); onSetMenuDocId(null); }} danger />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isExpanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {node.children.map(child => (
              <DocTreeNode
                key={child.id}
                node={child}
                activeDoc={activeDoc}
                expandedIds={expandedIds}
                menuDocId={menuDocId}
                renamingId={renamingId}
                renameVal={renameVal}
                renameRef={renameRef}
                onToggleExpand={onToggleExpand}
                onSelectDoc={onSelectDoc}
                onStartRename={onStartRename}
                onSubmitRename={onSubmitRename}
                onSetRenameVal={onSetRenameVal}
                onDeleteDoc={onDeleteDoc}
                onNewChild={onNewChild}
                onSetMenuDocId={onSetMenuDocId}
                onClose={onClose}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuButton({
  icon, label, onClick, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-2 px-3 py-1.5 transition-colors"
      style={{ fontSize: 13, color: danger ? 'var(--color-error)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? 'var(--color-error-light)' : 'var(--color-surface-secondary)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Main Sidebar ───────────────────────────────────────────────────────────
export default function Sidebar({
  workspace, documents, collections = [], activeDoc, activeCollection, user,
  onSelectDoc, onSelectCollection, onNewDoc, onNewCollection, onUpload, onDeleteDoc, onRenameDoc, onLogout,
  onClose, onOpenCommand,
}: Props) {
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  useEffect(() => {
    if (!activeDoc?.metadata?.parent_id) return;
    setExpandedIds(prev => new Set([...prev, activeDoc.metadata.parent_id]));
  }, [activeDoc?.id]);

  const startRename = (doc: Doc) => { setRenamingId(doc.id); setRenameVal(doc.title); };
  const submitRename = (id: string) => {
    if (renameVal.trim()) onRenameDoc(id, renameVal.trim());
    setRenamingId(null);
  };

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleNewChild = useCallback((parentId: string) => {
    setExpandedIds(prev => new Set([...prev, parentId]));
    onNewDoc(parentId);
  }, [onNewDoc]);

  const tree = buildTree(documents);
  const avatarLetter = (user?.name || user?.email || '?')[0].toUpperCase();

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ background: 'var(--color-surface-secondary)', borderRight: '1px solid var(--color-border)', width: '100%' }}
      onClick={() => setMenuDocId(null)}
    >
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{ height: 52, borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-accent)' }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: 'white', letterSpacing: '-0.5px' }}>P</span>
          </div>
          <span
            className="truncate"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}
          >
            {workspace?.name ?? 'My Workspace'}
          </span>
        </div>

        <button
          onClick={() => { onNewDoc(); onClose?.(); }}
          className="w-6 h-6 flex items-center justify-center rounded-md transition-colors flex-shrink-0"
          title="新增文件"
          style={{ color: 'var(--color-text-tertiary)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-tertiary)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="px-3 pt-2.5 pb-1.5 flex-shrink-0">
        <button
          onClick={onOpenCommand}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-placeholder)',
            fontSize: 12.5,
            boxShadow: 'var(--shadow-xs)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'; }}
        >
          <Search size={12} style={{ flexShrink: 0, color: 'var(--color-text-quaternary)' }} />
          <span className="flex-1">搜尋...</span>
          <kbd
            className="px-1 py-0.5 rounded text-center"
            style={{
              fontSize: 10,
              background: 'var(--color-surface-tertiary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'inherit',
              lineHeight: '14px',
            }}
          >⌘K</kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-2 mt-1">
        <div className="flex items-center justify-between px-4 py-1 mb-0.5">
          <span style={{ fontSize: 11, color: 'var(--color-text-quaternary)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            文件
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-quaternary)' }}>
            {documents.length}
          </span>
        </div>

        {documents.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500">
            <p className="text-xs">尚無文件</p>
          </div>
        ) : (
          <div>
            {tree.map(node => (
              <DocTreeNode
                key={node.id}
                node={node}
                activeDoc={activeDoc}
                expandedIds={expandedIds}
                menuDocId={menuDocId}
                renamingId={renamingId}
                renameVal={renameVal}
                renameRef={renameRef as React.RefObject<HTMLInputElement | null>}
                onToggleExpand={toggleExpand}
                onSelectDoc={onSelectDoc}
                onStartRename={startRename}
                onSubmitRename={submitRename}
                onSetRenameVal={setRenameVal}
                onDeleteDoc={onDeleteDoc}
                onNewChild={handleNewChild}
                onSetMenuDocId={setMenuDocId}
                onClose={onClose}
              />
            ))}
          </div>
        )}

        <div className="mt-4 pt-2 border-t border-gray-200/50">
          <div className="flex items-center justify-between px-4 py-1 mb-0.5">
            <span style={{ fontSize: 11, color: 'var(--color-text-quaternary)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              資料庫
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNewCollection(); }}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Plus size={11} />
            </button>
          </div>

          <div className="px-1">
            {collections.map(col => {
              const isActive = activeCollection?.id === col.id;
              return (
                <button
                  key={col.id}
                  onClick={() => { onSelectCollection(col); onClose?.(); }}
                  className="w-full flex items-center gap-2 rounded-md text-left transition-colors py-1.5 px-3 mb-0.5"
                  style={{
                    background: isActive ? 'var(--color-accent-light)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--color-panel-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'var(--color-accent-light)' : 'transparent'; }}
                >
                  <span style={{ fontSize: 13, flexShrink: 0 }}>{col.icon || '📊'}</span>
                  <span
                    className="flex-1 truncate"
                    style={{
                      fontSize: 13,
                      color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      fontWeight: isActive ? 500 : 400
                    }}
                  >
                    {col.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="flex-shrink-0 px-2 py-2"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <button
          onClick={() => { onUpload(); onClose?.(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors"
          style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-panel-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Upload size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          匯入文件
        </button>

        {user && (
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg mt-0.5 group cursor-default transition-colors"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-panel-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--color-accent)', color: 'white', fontSize: 11, fontWeight: 600 }}
            >
              {avatarLetter}
            </div>

            <div className="flex-1 min-w-0">
              <p
                className="truncate"
                style={{ fontSize: 12.5, color: 'var(--color-text-primary)', fontWeight: 500 }}
              >
                {user?.name || user?.email}
              </p>
            </div>

            <button
              onClick={onLogout}
              title="登出"
              className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-error)'; e.currentTarget.style.background = 'var(--color-error-light)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <LogOut size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
