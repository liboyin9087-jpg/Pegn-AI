import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Table as TableIcon, Columns, Calendar as CalendarIcon,
  GalleryVertical, List as ListIcon, Settings2, Download, X,
} from 'lucide-react';
import { Collection, CollectionView as ViewType } from '../../types/collection';
import { TableView } from './TableView';
import { KanbanView } from './KanbanView';
import { CalendarView } from './CalendarView';
import { ListView } from './ListView';
import { GalleryView } from './GalleryView';
import { SchemaEditor } from './SchemaEditor';
import { PropertiesPanel } from './PropertiesPanel';
import { exportCollection, updateCollectionView, updateCollectionSchema, listCollectionDocuments } from '../../api/client';
import { useCollectionDocuments } from '../../hooks/useCollections';

interface CollectionViewProps {
  collection: Collection;
  workspaceId: string;
  views: ViewType[];
  collections?: Collection[];          // all workspace collections, for relation/rollup
  onUpdateView: (viewId: string, updates: any) => void;
  onUpdateCollection?: (updated: Collection) => void;
  onOpenFullPage?: (rowId: string) => void;
}

export function CollectionView({
  collection,
  workspaceId,
  views,
  collections = [],
  onUpdateView,
  onUpdateCollection,
  onOpenFullPage,
}: CollectionViewProps) {
  const [activeViewId, setActiveViewId] = useState<string | null>(views[0]?.id || null);
  const activeView = views.find(v => v.id === activeViewId) || views[0];

  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [showSchemaEditor, setShowSchemaEditor] = useState(false);

  const { documents, loading, addDocument, editDocument } = useCollectionDocuments(collection.id);

  // ── Related items cache for relation/rollup cells ─────────────────────────
  const [relatedItems, setRelatedItems] = useState<Map<string, any[]>>(new Map());
  const prevRelColIds = useRef<string>('');

  useEffect(() => {
    const props = Object.values(collection.schema.properties);
    const ids = [...new Set(
      props
        .filter(p => p.type === 'relation' && p.relation?.targetCollectionId)
        .map(p => p.relation!.targetCollectionId),
    )];
    const key = ids.sort().join(',');
    if (key === prevRelColIds.current) return;
    prevRelColIds.current = key;
    if (ids.length === 0) return;

    Promise.all(
      ids.map(async id => {
        try {
          const data = await listCollectionDocuments(id);
          return [id, data.documents ?? []] as [string, any[]];
        } catch {
          return [id, []] as [string, any[]];
        }
      })
    ).then(results => setRelatedItems(new Map(results)));
  }, [collection.schema.properties]);

  const handleAddRow = async () => {
    try {
      await addDocument(workspaceId, '新頁面');
    } catch (error) {
      console.error('Failed to add row:', error);
    }
  };

  const handleEditCell = async (rowId: string, propertyId: string, value: any) => {
    try {
      const doc = documents.find(d => d.id === rowId);
      const currentProps = doc?.properties || {};
      await editDocument(rowId, {
        properties: { ...currentProps, [propertyId]: value },
      });
    } catch (error) {
      console.error('Failed to edit cell:', error);
    }
  };

  const handleUpdateView = async (viewId: string, updates: any) => {
    try {
      await updateCollectionView(viewId, updates);
      onUpdateView(viewId, updates);
    } catch (error) {
      console.error('Failed to update view:', error);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await exportCollection(collection.id, 'csv');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection.name}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('導出失敗，請重試');
    }
  };

  const handleSaveSchema = async (schema: { properties: Record<string, any> }) => {
    try {
      await updateCollectionSchema(collection.id, schema);
      onUpdateCollection?.({ ...collection, schema });
      setShowSchemaEditor(false);
    } catch (error) {
      console.error('Failed to save schema:', error);
    }
  };

  const ViewIcon = ({ type }: { type: string }) => {
    switch (type) {
      case 'table':    return <TableIcon size={14} />;
      case 'board':    return <Columns size={14} />;
      case 'calendar': return <CalendarIcon size={14} />;
      case 'gallery':  return <GalleryVertical size={14} />;
      case 'list':     return <ListIcon size={14} />;
      default:         return <TableIcon size={14} />;
    }
  };

  const renderView = () => {
    if (!activeView) return null;
    const commonProps = {
      collection,
      data: documents,
      onAddRow: handleAddRow,
    };
    switch (activeView.type) {
      case 'table':
        return (
          <TableView
            {...commonProps}
            onEditCell={handleEditCell}
            onOpenRow={setOpenRowId}
            relatedItems={relatedItems}
          />
        );
      case 'board':
        return (
          <KanbanView
            {...commonProps}
            onEditCell={handleEditCell}
          />
        );
      case 'calendar':
        return (
          <CalendarView
            {...commonProps}
            onOpenRow={setOpenRowId}
          />
        );
      case 'list':
        return (
          <ListView
            {...commonProps}
            onOpenRow={setOpenRowId}
          />
        );
      case 'gallery':
        return (
          <GalleryView
            {...commonProps}
            onOpenRow={setOpenRowId}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--color-surface)' }}>
      {/* View Tabs — Notion-style bottom-border tabs */}
      <div
        className="flex items-end flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)', padding: '0 16px' }}
      >
        {views.map(view => {
          const isActive = activeViewId === view.id;
          return (
            <button
              key={view.id}
              onClick={() => setActiveViewId(view.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', fontSize: 13, fontWeight: 500,
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: `2px solid ${isActive ? 'var(--color-text-primary)' : 'transparent'}`,
                marginBottom: -1,
                transition: 'color 0.1s, border-color 0.1s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
            >
              <ViewIcon type={view.type} />
              {view.name}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-1" style={{ paddingBottom: 4 }}>
          <button
            onClick={handleExport}
            style={{ padding: 6, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, display: 'flex' }}
            title="導出資料"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-secondary)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => setShowSchemaEditor(v => !v)}
            style={{
              padding: 6, background: showSchemaEditor ? 'var(--color-accent-light)' : 'none',
              color: showSchemaEditor ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              border: 'none', cursor: 'pointer', borderRadius: 6, display: 'flex',
            }}
            title="編輯 Schema"
            onMouseEnter={e => { if (!showSchemaEditor) { e.currentTarget.style.background = 'var(--color-surface-secondary)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; } }}
            onMouseLeave={e => { if (!showSchemaEditor) { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; } }}
          >
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* View Content + Side panels */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Main view */}
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView?.id || 'empty'}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="w-full h-full"
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Properties Panel (right side) */}
        <AnimatePresence>
          {openRowId && (
            <PropertiesPanel
              rowId={openRowId}
              data={documents}
              collection={collection}
              onClose={() => setOpenRowId(null)}
              onEditCell={handleEditCell}
              onOpenFullPage={onOpenFullPage}
            />
          )}
        </AnimatePresence>

        {/* Schema Editor (right side) */}
        <AnimatePresence>
          {showSchemaEditor && (
            <div className="relative">
              <button
                onClick={() => setShowSchemaEditor(false)}
                className="absolute top-3 right-3 z-20 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <X size={14} />
              </button>
              <SchemaEditor
                collection={collection}
                collections={collections}
                onSave={handleSaveSchema}
                onClose={() => setShowSchemaEditor(false)}
              />
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
