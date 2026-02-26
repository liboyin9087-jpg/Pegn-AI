import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  Panel,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { kgEntities, kgRelationships, kgExtract } from '../api/client';

const TYPE_COLOR: Record<string, string> = {
  org: '#6366f1',
  person: '#10b981',
  concept: '#f59e0b',
  location: '#3b82f6',
  event: '#ec4899',
  default: '#6b7280',
};

const TYPE_LABEL: Record<string, string> = {
  org: '🏢 組織',
  person: '👤 人物',
  concept: '💡 概念',
  location: '📍 地點',
  event: '📅 事件',
};

const ALL_TYPES = Object.keys(TYPE_COLOR).filter(k => k !== 'default');

// Force-directed layout simulation (simple spring layout)
function forceLayout(entities: any[], relationships: any[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = entities.length;
  if (n === 0) return positions;

  // Initial positions in a grid
  const cols = Math.ceil(Math.sqrt(n));
  entities.forEach((e, i) => {
    positions.set(e.id, {
      x: (i % cols) * 180 + 80 + Math.random() * 40,
      y: Math.floor(i / cols) * 140 + 80 + Math.random() * 40,
    });
  });

  if (n <= 1) return positions;

  // Build adjacency for connected nodes
  const adjacent = new Map<string, Set<string>>();
  entities.forEach(e => adjacent.set(e.id, new Set()));
  relationships.forEach(r => {
    adjacent.get(r.source_entity_id)?.add(r.target_entity_id);
    adjacent.get(r.target_entity_id)?.add(r.source_entity_id);
  });

  // Spring simulation iterations
  const k = 200; // spring length
  const repulsion = 8000;

  for (let iter = 0; iter < 60; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    entities.forEach(e => forces.set(e.id, { fx: 0, fy: 0 }));

    // Repulsion between all nodes
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const pi = positions.get(entities[i].id)!;
        const pj = positions.get(entities[j].id)!;
        const dx = pi.x - pj.x || 0.01;
        const dy = pi.y - pj.y || 0.01;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = repulsion / (dist * dist);
        const fi = forces.get(entities[i].id)!;
        const fj = forces.get(entities[j].id)!;
        fi.fx += (dx / dist) * force;
        fi.fy += (dy / dist) * force;
        fj.fx -= (dx / dist) * force;
        fj.fy -= (dy / dist) * force;
      }
    }

    // Attraction along edges
    relationships.forEach(r => {
      const pi = positions.get(r.source_entity_id);
      const pj = positions.get(r.target_entity_id);
      if (!pi || !pj) return;
      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist - k) * 0.05;
      const fi = forces.get(r.source_entity_id)!;
      const fj = forces.get(r.target_entity_id)!;
      if (fi) { fi.fx += (dx / dist) * force; fi.fy += (dy / dist) * force; }
      if (fj) { fj.fx -= (dx / dist) * force; fj.fy -= (dy / dist) * force; }
    });

    // Apply forces with damping
    const damping = 0.85 - iter * 0.01;
    entities.forEach(e => {
      const pos = positions.get(e.id)!;
      const f = forces.get(e.id)!;
      pos.x += f.fx * damping;
      pos.y += f.fy * damping;
    });
  }

  return positions;
}

export default function KGPanel({
  workspaceId,
  activeDoc,
}: {
  workspaceId: string;
  activeDoc?: any;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(false);
  const [extractText, setExtractText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set(ALL_TYPES));
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [allRelationships, setAllRelationships] = useState<any[]>([]);
  const [stats, setStats] = useState({ entities: 0, relationships: 0 });
  const [layout, setLayout] = useState<'force' | 'circle'>('force');
  const [neighborMode, setNeighborMode] = useState(false);

  const [editingNode, setEditingNode] = useState<any>(null);

  const buildGraph = useCallback((
    entities: any[],
    relationships: any[],
    filter: Set<string>,
    layoutMode: 'force' | 'circle'
  ) => {
    const filtered = entities.filter(e => filter.has(e.entity_type));
    const entityIds = new Set(filtered.map((e: any) => e.id));
    const filteredRels = relationships.filter(
      (r: any) => entityIds.has(r.source_entity_id) && entityIds.has(r.target_entity_id)
    );

    let positions: Map<string, { x: number; y: number }>;

    if (layoutMode === 'force') {
      positions = forceLayout(filtered, filteredRels);
    } else {
      // Circle layout
      positions = new Map();
      filtered.forEach((e, i) => {
        const angle = (i / filtered.length) * 2 * Math.PI - Math.PI / 2;
        const radius = Math.min(240, 100 + filtered.length * 10);
        positions.set(e.id, {
          x: 280 + radius * Math.cos(angle),
          y: 220 + radius * Math.sin(angle),
        });
      });
    }

    // Group by type for visual sizing
    const typeCounts = filtered.reduce((acc, e) => {
      acc[e.entity_type] = (acc[e.entity_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const newNodes: Node[] = filtered.map((e: any) => {
      const pos = positions.get(e.id) ?? { x: 280, y: 220 };
      const connectionCount = filteredRels.filter(
        r => r.source_entity_id === e.id || r.target_entity_id === e.id
      ).length;
      const size = Math.min(80, 60 + connectionCount * 5);

      return {
        id: e.id,
        position: pos,
        data: { label: e.name, type: e.entity_type, description: e.description, entity: e, connections: connectionCount },
        style: {
          background: TYPE_COLOR[e.entity_type] ?? TYPE_COLOR.default,
          color: 'white',
          border: selectedNode?.id === e.id ? '2px solid white' : 'none',
          borderRadius: e.entity_type === 'org' ? '6px' : '50%',
          fontSize: '10px',
          fontWeight: '500',
          padding: '4px 8px',
          minWidth: `${size}px`,
          maxWidth: '100px',
          textAlign: 'center' as const,
          cursor: 'pointer',
          boxShadow: `0 6px 16px ${TYPE_COLOR[e.entity_type] ?? TYPE_COLOR.default}26`,
          transition: 'all 0.2s',
          lineHeight: '1.3',
          wordBreak: 'break-word',
        },
      };
    });

    const newEdges: Edge[] = filteredRels.map((r: any) => ({
      id: r.id,
      source: r.source_entity_id,
      target: r.target_entity_id,
      label: r.relation_type,
      style: { stroke: '#c7c7c2', strokeWidth: 1.2 },
      labelStyle: { fill: '#6b6b6b', fontSize: 9 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
      labelBgPadding: [3, 4] as [number, number],
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#c7c7c2',
        width: 10,
        height: 10,
      },
    }));

    setNodes(newNodes);
    setEdges(newEdges);
  }, [setNodes, setEdges, selectedNode?.id]);

  const loadGraph = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [entRes, relRes] = await Promise.all([
        kgEntities(workspaceId),
        kgRelationships(workspaceId),
      ]);
      const entities = entRes.entities || [];
      const relationships = relRes.relationships || [];
      setAllEntities(entities);
      setAllRelationships(relationships);
      setStats({ entities: entities.length, relationships: relationships.length });
      buildGraph(entities, relationships, filterTypes, layout);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filterTypes, buildGraph, layout]);

  useEffect(() => { loadGraph(); }, [workspaceId]);

  // Rebuild graph when layout changes
  useEffect(() => {
    if (allEntities.length > 0) {
      buildGraph(allEntities, allRelationships, filterTypes, layout);
    }
  }, [layout]);

  const toggleType = (type: string) => {
    setFilterTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      buildGraph(allEntities, allRelationships, next, layout);
      return next;
    });
  };

  const handleExtract = async () => {
    const text = extractText || activeDoc?.content?.text;
    if (!text?.trim() || !workspaceId) return;
    setExtracting(true);
    try {
      await kgExtract(text, workspaceId);
      setExtractText('');
      await loadGraph();
    } finally {
      setExtracting(false);
    }
  };

  // Auto-extract from active doc (shortcut)
  const handleAutoExtract = async () => {
    if (!activeDoc?.content?.text || !workspaceId) return;
    setExtracting(true);
    try {
      await kgExtract(activeDoc.content.text, workspaceId);
      await loadGraph();
    } finally {
      setExtracting(false);
    }
  };

  const onConnect = useCallback((params: any) => setEdges(eds => addEdge(params, eds)), [setEdges]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.data.entity);
    setEditingNode(null);
  }, []);

  const handleUpdateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNode) return;
    // Placeholder for API call to update entity
    console.log('Updating node:', editingNode);
    
    // Optimistic update
    setAllEntities(prev => prev.map(ent => ent.id === editingNode.id ? editingNode : ent));
    setSelectedNode(editingNode);
    setEditingNode(null);
    // Rebuild graph
    buildGraph(
      allEntities.map(ent => ent.id === editingNode.id ? editingNode : ent),
      allRelationships,
      filterTypes,
      layout
    );
  };

  const handleDeleteNode = async () => {
    if (!selectedNode) return;
    if (!confirm(`確定要刪除實體「${selectedNode.name}」嗎？`)) return;
    
    // Placeholder for API call to delete entity
    console.log('Deleting node:', selectedNode.id);
    
    // Optimistic update
    const newEntities = allEntities.filter(ent => ent.id !== selectedNode.id);
    const newRelationships = allRelationships.filter(
      r => r.source_entity_id !== selectedNode.id && r.target_entity_id !== selectedNode.id
    );
    setAllEntities(newEntities);
    setAllRelationships(newRelationships);
    setSelectedNode(null);
    setEditingNode(null);
    setStats({ entities: newEntities.length, relationships: newRelationships.length });
    buildGraph(newEntities, newRelationships, filterTypes, layout);
  };

  // Get neighbors of selected node
  const neighborIds = selectedNode
    ? new Set([
        selectedNode.id,
        ...allRelationships
          .filter(r => r.source_entity_id === selectedNode.id || r.target_entity_id === selectedNode.id)
          .flatMap(r => [r.source_entity_id, r.target_entity_id]),
      ])
    : null;

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 抽取工具列 */}
      <div className="p-3 border-b border-border space-y-2 flex-shrink-0">
        <div className="flex gap-2">
          <input
            value={extractText}
            onChange={e => setExtractText(e.target.value)}
            placeholder="貼上文字抽取實體..."
            className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={handleExtract}
            disabled={extracting || (!extractText.trim() && !activeDoc?.content?.text)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-lg text-white text-xs disabled:opacity-40 transition-colors flex-shrink-0"
          >{extracting ? '...' : '抽取'}</button>
        </div>

        {/* Auto-extract from doc */}
        {activeDoc && (
          <button
            onClick={handleAutoExtract}
            disabled={extracting}
            className="w-full text-xs py-1.5 px-3 bg-panel hover:bg-surface-tertiary border border-border rounded-lg text-text-secondary transition-colors text-left"
          >
            ✨ 從「{activeDoc.title?.slice(0, 20)}」自動抽取實體
          </button>
        )}

        {/* 統計 + 佈局控制 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary">
            {stats.entities} 實體 · {stats.relationships} 關係
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setLayout(l => l === 'force' ? 'circle' : 'force')}
              className="text-xs text-text-tertiary hover:text-text-secondary px-2 py-0.5 bg-surface-tertiary rounded transition-colors"
              title={layout === 'force' ? '切換為環形佈局' : '切換為力導向佈局'}
            >{layout === 'force' ? '⭕ 環形' : '⚡ 力導向'}</button>
            <button onClick={loadGraph} className="text-xs text-text-tertiary hover:text-text-secondary px-2 py-0.5 bg-surface-tertiary rounded transition-colors">↻</button>
          </div>
        </div>

        {/* 類型過濾器 */}
        <div className="flex gap-1.5 flex-wrap">
          {ALL_TYPES.map(type => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all ${
                filterTypes.has(type) ? 'opacity-100' : 'opacity-25'
              }`}
              style={{
                background: `${TYPE_COLOR[type]}22`,
                border: `1px solid ${TYPE_COLOR[type]}66`,
                color: TYPE_COLOR[type],
              }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLOR[type] }} />
              {TYPE_LABEL[type] || type}
            </button>
          ))}
        </div>
      </div>

      {/* 圖譜區 */}
      <div className="flex-1 relative min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {nodes.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full text-center p-6">
            <div>
              <div className="text-3xl mb-2">🕸</div>
              <p className="text-sm text-text-secondary mb-1">尚無實體</p>
              <p className="text-xs text-text-tertiary">
                {activeDoc
                  ? '點擊上方按鈕從當前文件抽取實體'
                  : '貼上文字或選擇文件，然後點擊抽取'}
              </p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            style={{ background: '#fbfbf9' }}
          >
            <Background color="#e8e8e5" gap={24} />
            <Controls
              style={{ background: '#ffffff', border: '1px solid #e8e8e5' }}
              showInteractive={false}
            />
            <MiniMap
              style={{ background: '#ffffff' }}
              nodeColor={n => (n.style?.background as string) ?? '#6b7280'}
              maskColor="rgba(251, 251, 249, 0.75)"
            />

            {/* Legend */}
            <Panel position="top-left">
              <div className="bg-surface/90 backdrop-blur border border-border rounded-lg p-2 space-y-1">
                {ALL_TYPES.filter(t => filterTypes.has(t)).map(t => (
                  <div key={t} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: TYPE_COLOR[t] }} />
                    <span className="text-[10px] text-text-tertiary">{TYPE_LABEL[t] || t}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Node detail panel */}
            {selectedNode && (
              <Panel position="bottom-left">
                <div className="bg-surface border border-border rounded-xl p-3 w-64 shadow-lg">
                  {editingNode ? (
                    <form onSubmit={handleUpdateNode} className="space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-text-primary">編輯實體</span>
                        <button type="button" onClick={() => setEditingNode(null)} className="text-text-tertiary hover:text-text-primary">✕</button>
                      </div>
                      <input
                        value={editingNode.name}
                        onChange={e => setEditingNode({ ...editingNode, name: e.target.value })}
                        className="w-full bg-surface-secondary border border-border rounded-lg px-2 py-1 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent"
                        placeholder="實體名稱"
                      />
                      <select
                        value={editingNode.entity_type}
                        onChange={e => setEditingNode({ ...editingNode, entity_type: e.target.value })}
                        className="w-full bg-surface-secondary border border-border rounded-lg px-2 py-1 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent"
                      >
                        {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
                      </select>
                      <textarea
                        value={editingNode.description || ''}
                        onChange={e => setEditingNode({ ...editingNode, description: e.target.value })}
                        className="w-full bg-surface-secondary border border-border rounded-lg px-2 py-1 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent resize-none"
                        placeholder="描述..."
                        rows={2}
                      />
                      <div className="flex gap-2 pt-1">
                        <button type="submit" className="flex-1 bg-accent hover:bg-accent-hover text-white text-xs py-1.5 rounded-lg transition-colors">儲存</button>
                        <button type="button" onClick={() => setEditingNode(null)} className="flex-1 bg-surface-tertiary hover:bg-surface-secondary text-text-secondary text-xs py-1.5 rounded-lg transition-colors">取消</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-sm flex-shrink-0"
                            style={{ background: TYPE_COLOR[selectedNode.entity_type] ?? TYPE_COLOR.default }}
                          />
                          <span className="text-xs font-medium text-text-primary truncate">{selectedNode.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => setEditingNode(selectedNode)} className="text-text-tertiary hover:text-accent transition-colors" title="編輯">✎</button>
                          <button onClick={handleDeleteNode} className="text-text-tertiary hover:text-red-500 transition-colors" title="刪除">🗑</button>
                        </div>
                      </div>
                      <div className="text-xs text-text-tertiary mb-1">
                        類型：<span style={{ color: TYPE_COLOR[selectedNode.entity_type] ?? '#6b7280' }}>
                          {TYPE_LABEL[selectedNode.entity_type] || selectedNode.entity_type}
                        </span>
                      </div>
                      {selectedNode.description && (
                        <p className="text-xs text-text-secondary line-clamp-3 mb-2">{selectedNode.description}</p>
                      )}
                      {/* Connections */}
                      <div className="text-xs text-text-tertiary">
                        連接關係：{
                          allRelationships.filter(
                            r => r.source_entity_id === selectedNode.id || r.target_entity_id === selectedNode.id
                          ).length
                        } 條
                      </div>
                      {/* Related entities */}
                      <div className="mt-2 space-y-0.5">
                        {allRelationships
                          .filter(r => r.source_entity_id === selectedNode.id || r.target_entity_id === selectedNode.id)
                          .slice(0, 3)
                          .map((r, i) => {
                            const otherId = r.source_entity_id === selectedNode.id ? r.target_entity_id : r.source_entity_id;
                            const other = allEntities.find(e => e.id === otherId);
                            return other ? (
                              <div key={i} className="text-xs text-text-tertiary flex items-center gap-1">
                                <span className="text-text-quaternary">{r.source_entity_id === selectedNode.id ? '→' : '←'}</span>
                                <span className="text-accent/70">{r.relation_type}</span>
                                <span className="truncate text-text-tertiary">{other.name}</span>
                              </div>
                            ) : null;
                          })
                        }
                      </div>
                      <button
                        onClick={() => setSelectedNode(null)}
                        className="mt-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                      >✕ 關閉</button>
                    </>
                  )}
                </div>
              </Panel>
            )}
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
