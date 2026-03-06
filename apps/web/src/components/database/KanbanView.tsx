import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Plus, MoreHorizontal, Calendar, MessageSquare, GripVertical } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Collection } from '../../types/collection';

//  Types 

interface KanbanViewProps {
  collection: Collection;
  data: any[];
  groupBy?: string;
  onAddRow: () => void;
  onEditCell: (rowId: string, propertyId: string, value: any) => void;
}

interface GroupOption {
  label: string;
  value: string;
  color: string;
  textColor: string;
}

//  Column drop target 

function DroppableColumn({
  group,
  isDragOver,
  children,
}: {
  group: GroupOption;
  isDragOver: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex-1 flex flex-col gap-2.5 min-h-[120px] rounded-xl p-2 transition-colors duration-150"
      style={{
        background: isDragOver ? `${group.color}88` : `${group.color}44`,
        outline: isDragOver ? `2px dashed ${group.color}` : 'none',
        outlineOffset: 2,
      }}
    >
      {children}
    </div>
  );
}

//  Sortable card 

function SortableCard({ item, isDragging }: { item: any; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    touchAction: 'none',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <CardContent item={item} dragHandleProps={listeners} />
    </div>
  );
}

//  Card content (shared between sortable + drag overlay) 

function CardContent({
  item,
  dragHandleProps,
  isOverlay = false,
}: {
  item: any;
  dragHandleProps?: Record<string, any>;
  isOverlay?: boolean;
}) {
  return (
    <div
      className="bg-white rounded-xl border border-gray-100 p-3.5 group/card select-none"
      style={{
        boxShadow: isOverlay
          ? '0 16px 32px -8px rgba(0,0,0,0.18), 0 0 0 1.5px #2383e2'
          : '0 1px 3px rgba(0,0,0,0.06)',
        cursor: isOverlay ? 'grabbing' : 'grab',
      }}
    >
      {/* Drag handle + title row */}
      <div className="flex items-start gap-1.5 mb-2.5">
        <button
          className="mt-0.5 flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors cursor-grab active:cursor-grabbing"
          {...dragHandleProps}
          tabIndex={-1}
          aria-label="拖曳"
          onClick={e => e.stopPropagation()}
        >
          <GripVertical size={13} />
        </button>
        <h4 className="text-sm font-semibold text-gray-800 line-clamp-2 flex-1">
          {item.title || item.properties?.name || '無標題項目'}
        </h4>
      </div>

      {/* Tags */}
      {item.properties?.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {(item.properties.tags as string[]).map((tag, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] font-medium text-gray-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2.5 border-t border-gray-50">
        <div className="flex -space-x-1.5">
          <div className="w-5 h-5 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center text-[9px] text-white font-bold">
            A
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-gray-400">
          <div className="flex items-center gap-0.5">
            <MessageSquare size={11} />
            <span className="text-[10px]">0</span>
          </div>
          {item.properties?.due && (
            <div className="flex items-center gap-0.5">
              <Calendar size={11} />
              <span className="text-[10px]">{String(item.properties.due).slice(0, 6)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

//  Main KanbanView 

export function KanbanView({
  collection,
  data,
  groupBy = 'status',
  onAddRow,
  onEditCell,
}: KanbanViewProps) {
  const [activeItem, setActiveItem] = useState<any | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Derive group options from schema if available, else fallback defaults
  const schemaProp = collection.schema?.properties?.[groupBy];
  const groupOptions: GroupOption[] =
    schemaProp?.type === 'select' && schemaProp.options?.length
      ? schemaProp.options.map((o: any) => ({
          label: o.label ?? o.value,
          value: o.value,
          color: o.color ?? '#e2e8f0',
          textColor: 'rgba(0,0,0,0.65)',
        }))
      : [
          { label: '未開始',  value: 'todo',        color: '#e2e8f0', textColor: 'rgba(0,0,0,0.6)' },
          { label: '進行中',  value: 'in-progress',  color: '#dbeafe', textColor: '#1d4ed8' },
          { label: '已完成',  value: 'done',         color: '#dcfce7', textColor: '#15803d' },
        ];

  const groupedData = groupOptions.map(group => ({
    ...group,
    items: data.filter(
      item => (item.properties?.[groupBy] ?? (group.value === 'todo' ? group.value : '')) === group.value,
    ),
  }));

  // Build a lookup: itemId  current group value
  const itemGroupMap = useCallback(
    (id: string): string =>
      data.find(d => d.id === id)?.properties?.[groupBy] ?? groupOptions[0]?.value ?? 'todo',
    [data, groupBy, groupOptions],
  );

  // Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const item = data.find(d => d.id === event.active.id);
    setActiveItem(item ?? null);
  };

  const handleDragOver = (event: any) => {
    const { over } = event;
    if (!over) { setDragOverColumn(null); return; }
    // over.id is either a card id or a column value
    const colValue = groupOptions.find(g => g.value === over.id)
      ? over.id
      : itemGroupMap(String(over.id));
    setDragOverColumn(colValue);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);
    setDragOverColumn(null);
    if (!over) return;

    const fromGroup = itemGroupMap(String(active.id));
    // Destination: over.id is a column value or a card id (in which case use its group)
    const toGroup = groupOptions.find(g => g.value === over.id)
      ? String(over.id)
      : itemGroupMap(String(over.id));

    if (fromGroup !== toGroup) {
      onEditCell(String(active.id), groupBy, toGroup);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full bg-gray-50/40 p-5 gap-4 overflow-x-auto">
        {groupedData.map(group => (
          <div key={group.value} className="flex-shrink-0 w-72 flex flex-col group/column">
            {/* Column header */}
            <div className="flex items-center justify-between mb-2.5 px-1">
              <div className="flex items-center gap-2">
                <span
                  className="px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider"
                  style={{ background: group.color, color: group.textColor }}
                >
                  {group.label}
                </span>
                <span className="text-gray-400 text-xs font-medium tabular-nums">
                  {group.items.length}
                </span>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover/column:opacity-100 transition-opacity">
                <button
                  onClick={onAddRow}
                  className="p-1 hover:bg-gray-200 rounded transition-colors text-gray-400 hover:text-gray-600"
                  title="新增項目"
                >
                  <Plus size={13} />
                </button>
                <button className="p-1 hover:bg-gray-200 rounded transition-colors text-gray-400 hover:text-gray-600">
                  <MoreHorizontal size={13} />
                </button>
              </div>
            </div>

            {/* Drop zone */}
            <SortableContext
              items={group.items.map(i => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <DroppableColumn
                group={group}
                isDragOver={dragOverColumn === group.value && activeItem !== null}
              >
                {group.items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                    <Plus size={20} className="mb-1.5 opacity-40" />
                    <span className="text-xs">拖曳卡片至此</span>
                  </div>
                ) : (
                  group.items.map(item => (
                    <SortableCard
                      key={item.id}
                      item={item}
                      isDragging={activeItem?.id === item.id}
                    />
                  ))
                )}
              </DroppableColumn>
            </SortableContext>

            {/* Add card button */}
            <button
              onClick={onAddRow}
              className="mt-2 flex items-center gap-1.5 px-2 py-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 rounded-lg transition-all text-xs w-full"
            >
              <Plus size={13} />
              新增項目
            </button>
          </div>
        ))}

        {/* Add column */}
        <div className="flex-shrink-0 w-72">
          <button className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:text-gray-600 hover:border-gray-300 hover:bg-white transition-all text-sm font-medium flex items-center justify-center gap-2">
            <Plus size={15} />
            新增分組
          </button>
        </div>
      </div>

      {/* Drag overlay  rendered outside the scroll container for correct z-index */}
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
        {activeItem ? (
          <motion.div
            initial={{ scale: 1 }}
            animate={{ scale: 1.04, rotate: 1.5 }}
            style={{ width: 272 }}
          >
            <CardContent item={activeItem} isOverlay />
          </motion.div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}