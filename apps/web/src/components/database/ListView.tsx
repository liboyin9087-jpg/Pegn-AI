import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, ExternalLink } from 'lucide-react';
import { Collection } from '../../types/collection';

interface ListViewProps {
  collection: Collection;
  data: any[];
  onAddRow: () => void;
  onOpenRow: (id: string) => void;
}

function getGroupKey(doc: any, groupByPropId: string): string {
  const val = doc.properties?.[groupByPropId];
  if (val === null || val === undefined || val === '') return '（無分組）';
  return String(val);
}

export function ListView({ collection, data, onAddRow, onOpenRow }: ListViewProps) {
  const properties = Object.entries(collection.schema.properties);

  // Choose group-by property: first select/multi_select/checkbox, else no grouping
  const groupByEntry = useMemo(
    () => properties.find(([, p]) => p.type === 'select' || p.type === 'multi_select' || p.type === 'checkbox'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collection.schema.properties]
  );
  const [groupByPropId] = groupByEntry ?? [];

  // Visible property columns (up to 3, excluding group-by prop)
  const visibleProps = useMemo(
    () => properties.filter(([id]) => id !== groupByPropId).slice(0, 3),
    [properties, groupByPropId]
  );

  // Group data
  const groups = useMemo<{ label: string; rows: any[] }[]>(() => {
    if (!groupByPropId) return [{ label: '', rows: data }];
    const map = new Map<string, any[]>();
    for (const doc of data) {
      const key = getGroupKey(doc, groupByPropId);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(doc);
    }
    return Array.from(map.entries()).map(([label, rows]) => ({ label, rows }));
  }, [data, groupByPropId]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <span style={{ fontSize: 13, color: '#6b6b7a' }}>
          {data.length} 筆記錄{groupByEntry ? `，依「${groupByEntry[1].name}」分組` : ''}
        </span>
        <button
          onClick={onAddRow}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-opacity"
          style={{ background: 'var(--color-accent, #2383e2)' }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <Plus size={13} /> 新增
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {groups.map(group => {
          const isCollapsed = collapsedGroups.has(group.label);
          return (
            <div key={group.label}>
              {/* Group header (only if grouped) */}
              {groupByPropId && (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left sticky top-0 z-10"
                  style={{
                    background: '#f9f9fb',
                    borderBottom: '1px solid #f0f0f4',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#37352f',
                  }}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span>{group.label}</span>
                  <span style={{ fontSize: 11, color: '#a0a0ae', fontWeight: 400 }}>
                    {group.rows.length}
                  </span>
                </button>
              )}

              {/* Rows */}
              {!isCollapsed && (
                <div>
                  {group.rows.map(row => (
                    <div
                      key={row.id}
                      className="group flex items-center gap-3 px-4 py-2.5 border-b transition-colors"
                      style={{ borderColor: '#f0f0f4' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Icon + Title */}
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{row.metadata?.icon ?? '📝'}</span>
                      <span
                        className="flex-1 truncate"
                        style={{ fontSize: 13.5, color: '#37352f', fontWeight: 500 }}
                      >
                        {row.title || '未命名'}
                      </span>

                      {/* Property chips */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {visibleProps.map(([propId, prop]) => {
                          const val = row.properties?.[propId];
                          if (val == null || val === '') return null;
                          return (
                            <span
                              key={propId}
                              style={{
                                fontSize: 11,
                                color: '#6b6b7a',
                                background: '#f0f0f4',
                                borderRadius: 4,
                                padding: '1px 6px',
                                maxWidth: 100,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={`${prop.name}: ${String(val)}`}
                            >
                              {String(val)}
                            </span>
                          );
                        })}
                      </div>

                      {/* Open button */}
                      <button
                        onClick={() => onOpenRow(row.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-6 h-6 rounded-md"
                        style={{ color: '#6b6b7a', flexShrink: 0 }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f0f0f4')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        title="開啟詳情"
                      >
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add row footer */}
        <button
          onClick={onAddRow}
          className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors"
          style={{ fontSize: 13, color: '#a0a0ae' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Plus size={13} /> 新增一筆記錄
        </button>
      </div>
    </div>
  );
}
