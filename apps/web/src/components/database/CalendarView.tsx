import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Collection } from '../../types/collection';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n: number) { return String(n).padStart(2, '0'); }

interface CalendarViewProps {
  collection: Collection;
  data: any[];
  onAddRow: () => void;
  onOpenRow: (id: string) => void;
}

export function CalendarView({ collection, data, onAddRow, onOpenRow }: CalendarViewProps) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Find the first date property
  const datePropEntry = useMemo(
    () => Object.entries(collection.schema.properties).find(([, p]) => p.type === 'date'),
    [collection.schema.properties]
  );
  const [datePropId] = datePropEntry ?? [];

  // Map YYYY-MM-DD → documents
  const eventsByDate = useMemo<Record<string, any[]>>(() => {
    if (!datePropId) return {};
    const map: Record<string, any[]> = {};
    for (const doc of data) {
      const raw = doc.properties?.[datePropId];
      if (!raw) continue;
      const key = String(raw).slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(doc);
    }
    return map;
  }, [data, datePropId]);

  const { year, month } = viewDate;
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  // Build 6×7 grid
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(year, month).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' });

  const prevMonth = () => {
    setViewDate(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 });
  };
  const nextMonth = () => {
    setViewDate(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 });
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: '#6b6b7a' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f4f5f7')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          ><ChevronLeft size={15} /></button>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#37352f', minWidth: 120, textAlign: 'center' }}>{monthLabel}</span>
          <button
            onClick={nextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: '#6b6b7a' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f4f5f7')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          ><ChevronRight size={15} /></button>
        </div>
        <div className="flex items-center gap-2">
          {!datePropId && (
            <span style={{ fontSize: 12, color: '#a0a0ae' }}>請先在 Schema 中新增「日期」欄位</span>
          )}
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
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto px-2 pb-2">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 sticky top-0 bg-white z-10">
          {WEEKDAYS.map(d => (
            <div
              key={d}
              className="py-2 text-center"
              style={{ fontSize: 12, color: '#a0a0ae', fontWeight: 500 }}
            >{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7" style={{ borderTop: '1px solid #f0f0f4' }}>
          {cells.map((day, idx) => {
            const isToday = day !== null && year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
            const dateKey = day !== null ? `${year}-${pad(month + 1)}-${pad(day)}` : '';
            const events = dateKey ? (eventsByDate[dateKey] ?? []) : [];

            return (
              <div
                key={idx}
                className="group relative"
                style={{
                  minHeight: 96,
                  border: '1px solid #f0f0f4',
                  borderTop: 'none',
                  borderLeft: idx % 7 === 0 ? 'none' : '1px solid #f0f0f4',
                  background: day === null ? '#fafafa' : 'white',
                  padding: 4,
                }}
              >
                {day !== null && (
                  <>
                    <div
                      className="flex items-center justify-center rounded-full mb-1 mx-auto"
                      style={{
                        width: 22,
                        height: 22,
                        fontSize: 12,
                        fontWeight: isToday ? 700 : 400,
                        color: isToday ? 'white' : '#6b6b7a',
                        background: isToday ? 'var(--color-accent, #2383e2)' : 'transparent',
                      }}
                    >{day}</div>

                    {/* Events */}
                    <div className="space-y-0.5">
                      {events.slice(0, 3).map(ev => (
                        <button
                          key={ev.id}
                          onClick={() => onOpenRow(ev.id)}
                          className="w-full text-left truncate px-1 py-0.5 rounded text-xs transition-colors"
                          style={{
                            background: 'var(--color-accent-light, #e8f1fb)',
                            color: 'var(--color-accent, #2383e2)',
                            fontSize: 11,
                          }}
                        >
                          {ev.metadata?.icon && <span style={{ marginRight: 2 }}>{ev.metadata.icon}</span>}
                          {ev.title}
                        </button>
                      ))}
                      {events.length > 3 && (
                        <div style={{ fontSize: 10, color: '#a0a0ae', paddingLeft: 4 }}>+{events.length - 3} 更多</div>
                      )}
                    </div>

                    {/* Hover add button */}
                    <button
                      onClick={onAddRow}
                      className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: '#f0f0f4', color: '#6b6b7a' }}
                    >
                      <Plus size={10} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
