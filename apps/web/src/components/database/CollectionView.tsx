import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Table as TableIcon, Columns, Calendar as CalendarIcon,
  GalleryVertical, List as ListIcon, Settings2, Download, X,
  Filter, ArrowUpDown, Plus, Trash2,
} from 'lucide-react';

// ── Filter / Sort types ───────────────────────────────────────
interface FilterRule {
  id: string;
  propertyId: string;
  op: 'contains' | 'not_contains' | 'eq' | 'ne' | 'is_empty' | 'is_not_empty';
  value: string;
}
interface SortRule {
  id: string;
  propertyId: string;
  dir: 'asc' | 'desc';
}
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
  const [showFilterSort, setShowFilterSort] = useState(false);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [sorts, setSorts] = useState<SortRule[]>([]);

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

  // ── Apply filters & sorts to documents ───────────────────────────────────
  const filteredDocs = useMemo(() => {
    let result = [...documents];
    for (const f of filters) {
      result = result.filter(doc => {
        const rawVal = String(doc.properties?.[f.propertyId] ?? doc.title ?? '').toLowerCase();
        const fVal = f.value.toLowerCase();
        switch (f.op) {
          case 'contains':     return rawVal.includes(fVal);
          case 'not_contains': return !rawVal.includes(fVal);
          case 'eq':           return rawVal === fVal;
          case 'ne':           return rawVal !== fVal;
          case 'is_empty':     return rawVal === '';
          case 'is_not_empty': return rawVal !== '';
          default:             return true;
        }
      });
    }
    if (sorts.length > 0) {
      result.sort((a, b) => {
        for (const s of sorts) {
          const aVal = String(a.properties?.[s.propertyId] ?? a.title ?? '');
          const bVal = String(b.properties?.[s.propertyId] ?? b.title ?? '');
          const cmp = aVal.localeCompare(bVal, 'zh-TW');
          if (cmp !== 0) return s.dir === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }
    return result;
  }, [documents, filters, sorts]);

  const schemaProps = Object.entries(collection.schema.properties ?? {});
  const propOptions = [{ id: '__title__', name: '標題' }, ...schemaProps.map(([id, p]: [string, any]) => ({ id, name: p.name ?? id }))];

  const addFilter = () => setFilters(prev => [...prev, { id: Math.random().toString(36).slice(2), propertyId: '__title__', op: 'contains', value: '' }]);
  const addSort   = () => setSorts(prev  => [...prev, { id: Math.random().toString(36).slice(2), propertyId: '__title__', dir: 'asc' }]);

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
      data: filteredDocs,
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
          {/* Filter & Sort toggle */}
          <button
            onClick={() => setShowFilterSort(v => !v)}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer',
              background: showFilterSort ? 'var(--color-accent-light)' : 'none',
              color: showFilterSort ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            title="篩選與排序"
          >
            <Filter size={13} />
            {(filters.length + sorts.length) > 0 ? `${filters.length + sorts.length}` : '篩選'}
          </button>
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

      {/* Filter / Sort Bar */}
      <AnimatePresence>
        {showFilterSort && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-secondary)', overflow: 'hidden', flexShrink: 0 }}
          >
            <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Filters */}
              {filters.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>篩選條件</span>
                  {filters.map(f => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <select value={f.propertyId} onChange={e => setFilters(prev => prev.map(x => x.id === f.id ? { ...x, propertyId: e.target.value } : x))}
                        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                        {propOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select value={f.op} onChange={e => setFilters(prev => prev.map(x => x.id === f.id ? { ...x, op: e.target.value as FilterRule['op'] } : x))}
                        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                        <option value="contains">包含</option>
                        <option value="not_contains">不包含</option>
                        <option value="eq">等於</option>
                        <option value="ne">不等於</option>
                        <option value="is_empty">為空</option>
                        <option value="is_not_empty">不為空</option>
                      </select>
                      {f.op !== 'is_empty' && f.op !== 'is_not_empty' && (
                        <input value={f.value} onChange={e => setFilters(prev => prev.map(x => x.id === f.id ? { ...x, value: e.target.value } : x))}
                          placeholder="值..." style={{ fontSize: 12, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', width: 120, outline: 'none' }} />
                      )}
                      <button onClick={() => setFilters(prev => prev.filter(x => x.id !== f.id))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', padding: 2 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Sorts */}
              {sorts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>排序</span>
                  {sorts.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <select value={s.propertyId} onChange={e => setSorts(prev => prev.map(x => x.id === s.id ? { ...x, propertyId: e.target.value } : x))}
                        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                        {propOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select value={s.dir} onChange={e => setSorts(prev => prev.map(x => x.id === s.id ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x))}
                        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                        <option value="asc">遞增 ↑</option>
                        <option value="desc">遞減 ↓</option>
                      </select>
                      <button onClick={() => setSorts(prev => prev.filter(x => x.id !== s.id))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', padding: 2 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add buttons */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={addFilter}
                  style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                  <Plus size={12} /> 新增篩選
                </button>
                <button onClick={addSort}
                  style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                  <ArrowUpDown size={12} /> 新增排序
                </button>
                {(filters.length + sorts.length) > 0 && (
                  <button onClick={() => { setFilters([]); setSorts([]); }}
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: '#c93b37', cursor: 'pointer', marginLeft: 'auto' }}>
                    清除全部
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
