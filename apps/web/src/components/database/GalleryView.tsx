import React from 'react';
import { Plus, ExternalLink } from 'lucide-react';
import { Collection } from '../../types/collection';

interface GalleryViewProps {
  collection: Collection;
  data: any[];
  onAddRow: () => void;
  onOpenRow: (id: string) => void;
}

const COVER_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
  'linear-gradient(135deg, #96fbc4 0%, #f9f586 100%)',
];

function cardGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[hash % COVER_GRADIENTS.length];
}

export function GalleryView({ collection, data, onAddRow, onOpenRow }: GalleryViewProps) {
  const properties = Object.entries(collection.schema.properties);
  // Show up to 3 properties as chips on each card
  const chipProps = properties.slice(0, 3);

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <span style={{ fontSize: 13, color: '#6b6b7a' }}>{data.length} 筆記錄</span>
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

      {/* Cards grid */}
      <div
        className="flex-1 overflow-y-auto p-4"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
          alignContent: 'start',
        }}
      >
        {data.map(row => {
          const cover = row.metadata?.cover ?? cardGradient(row.id);
          const isGradient = cover.startsWith('linear-gradient');

          return (
            <div
              key={row.id}
              className="group relative rounded-xl overflow-hidden flex flex-col transition-shadow"
              style={{
                background: 'white',
                border: '1px solid #e8e8ee',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
                (e.currentTarget as HTMLElement).style.transform = 'none';
              }}
              onClick={() => onOpenRow(row.id)}
            >
              {/* Cover */}
              <div
                style={{
                  height: 120,
                  background: isGradient ? cover : `url(${cover}) center/cover no-repeat`,
                  flexShrink: 0,
                }}
              />

              {/* Card body */}
              <div className="flex flex-col gap-2 p-3">
                {/* Icon + Title */}
                <div className="flex items-start gap-2">
                  <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.3 }}>
                    {row.metadata?.icon ?? '📝'}
                  </span>
                  <span
                    className="font-medium leading-snug"
                    style={{
                      fontSize: 13.5,
                      color: '#37352f',
                      wordBreak: 'break-word',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {row.title || '未命名'}
                  </span>
                </div>

                {/* Property chips */}
                {chipProps.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {chipProps.map(([propId, prop]) => {
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
                          }}
                          title={prop.name}
                        >
                          {String(val)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Hover overlay: open button */}
              <button
                onClick={e => { e.stopPropagation(); onOpenRow(row.id); }}
                className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(255,255,255,0.85)', color: '#37352f', backdropFilter: 'blur(4px)' }}
                title="開啟詳情"
              >
                <ExternalLink size={13} />
              </button>
            </div>
          );
        })}

        {/* Add card */}
        <button
          onClick={onAddRow}
          className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors"
          style={{
            height: 180,
            borderColor: '#e0e0ea',
            color: '#a0a0ae',
            fontSize: 13,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent, #2383e2)';
            (e.currentTarget as HTMLElement).style.color = 'var(--color-accent, #2383e2)';
            (e.currentTarget as HTMLElement).style.background = '#f0f6ff';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = '#e0e0ea';
            (e.currentTarget as HTMLElement).style.color = '#a0a0ae';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          <Plus size={20} />
          <span>新增記錄</span>
        </button>
      </div>
    </div>
  );
}
