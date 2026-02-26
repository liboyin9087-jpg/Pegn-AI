import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getToken } from '../api/client';

type Mode = 'auto' | 'hybrid' | 'graph';

interface Source {
  content: string;
  document_id?: string;
  document_title?: string;
  title?: string;
  score?: number;
  type?: string;
}

interface Entity {
  id?: string;
  name: string;
  entity_type: string;
}

interface Msg {
  role: 'user' | 'ai';
  text: string;
  streaming?: boolean;
  sources?: Source[];
  entities?: Entity[];
  mode_used?: 'hybrid' | 'graph';
  routing_reason?: string;
}

const SUGGESTED = [
  '幫我整理這份工作區的重點',
  '有哪些重要概念需要了解？',
  '列出所有提到的人名或組織',
  '分析文件中的主要論點',
  '幫我做一份摘要',
  '有哪些待辦事項或行動計畫？',
];

const MODE_LABEL: Record<Mode, string> = {
  auto: 'Auto',
  hybrid: 'Hybrid',
  graph: 'Graph',
};

export default function GraphRAGChat({
  workspaceId,
  activeDoc,
}: {
  workspaceId: string;
  activeDoc?: any;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'ai',
      text: '你好！我是知識助理，可自動在 Hybrid Search 與 GraphRAG 間切換。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>('auto');
  const [showSuggested, setShowSuggested] = useState(true);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (q?: string) => {
    const query = (q ?? input).trim();
    if (!query || loading || !workspaceId) return;

    setInput('');
    setShowSuggested(false);
    setLoading(true);

    setMessages(prev => [...prev, { role: 'user', text: query }, { role: 'ai', text: '', streaming: true }]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = getToken();
      const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
      const res = await fetch(`${apiBase}/api/v1/knowledge/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, workspace_id: workspaceId, mode }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error('stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let sources: Source[] = [];
      let entities: Entity[] = [];
      let modeUsed: 'hybrid' | 'graph' | undefined;
      let routingReason = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'meta') {
              sources = data.sources || [];
              entities = data.entities || [];
              modeUsed = data.mode_used;
              routingReason = data.routing_reason || '';
            } else if (data.type === 'token') {
              accumulated += data.token;
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'ai') {
                  next[next.length - 1] = {
                    ...last,
                    text: accumulated,
                    streaming: true,
                    mode_used: modeUsed,
                    routing_reason: routingReason,
                  };
                }
                return next;
              });
            } else if (data.type === 'done') {
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === 'ai') {
                  next[next.length - 1] = {
                    ...last,
                    text: accumulated,
                    streaming: false,
                    sources,
                    entities,
                    mode_used: modeUsed,
                    routing_reason: routingReason,
                  };
                }
                return next;
              });
            } else if (data.type === 'error') {
              throw new Error(data.message || 'Knowledge stream error');
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'ai') {
            next[next.length - 1] = {
              ...last,
              text: '知識查詢失敗，請稍後再試。',
              streaming: false,
            };
          }
          return next;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, loading, mode, workspaceId]);

  const handleClear = () => {
    setMessages([{ role: 'ai', text: '對話已清除。請輸入新的問題。' }]);
    setShowSuggested(true);
  };

  const toggleSources = (idx: number) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const focusEntityInKg = (entity: Entity) => {
    localStorage.setItem('kg_focus_entity', JSON.stringify(entity));
    window.dispatchEvent(new CustomEvent('kg:focus-entity', { detail: entity }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0 gap-2">
        <span className="text-xs text-text-tertiary">
          {messages.length - 1} 則對話
          {activeDoc && <span className="text-accent"> · {activeDoc.title}</span>}
        </span>
        <div className="flex items-center gap-1">
          {(['auto', 'hybrid', 'graph'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="text-xs px-2 py-0.5 rounded border transition-colors"
              style={{
                borderColor: mode === m ? 'var(--color-accent)' : 'var(--color-border)',
                color: mode === m ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                background: mode === m ? 'var(--color-accent-light)' : 'var(--color-surface)',
              }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="text-xs text-text-tertiary hover:text-text-secondary transition-colors ml-1"
            title="清除對話記錄"
          >
            清除
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${
              m.role === 'user'
                ? 'bg-accent text-white rounded-br-sm'
                : 'bg-panel border border-border text-text-primary rounded-bl-sm'
            }`}>
              <p className="whitespace-pre-wrap leading-relaxed">{m.text}
                {m.streaming && (
                  <span className="inline-block w-0.5 h-4 bg-accent animate-pulse ml-0.5 align-middle" />
                )}
              </p>

              {m.mode_used && !m.streaming && (
                <div className="mt-2 text-[11px] text-text-tertiary">
                  路由：<span className="text-accent font-medium">{m.mode_used}</span>
                  {m.routing_reason ? ` · ${m.routing_reason}` : ''}
                </div>
              )}

              {m.sources && m.sources.length > 0 && !m.streaming && (
                <div className="mt-2 pt-2 border-t border-border">
                  <button
                    onClick={() => toggleSources(i)}
                    className="text-xs text-text-tertiary hover:text-text-secondary flex items-center gap-1 transition-colors"
                  >
                    <span>{expandedSources.has(i) ? '▼' : '▶'}</span>
                    來源 ({m.sources.length})
                  </button>
                  {expandedSources.has(i) && (
                    <div className="mt-2 space-y-1.5">
                      {m.sources.slice(0, 6).map((s, j) => (
                        <div key={j} className="bg-surface-secondary rounded-lg p-2 border border-border">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-xs font-medium text-accent truncate flex-1">
                              [{j + 1}] {s.document_title || s.title || s.document_id || '未命名文件'}
                              {s.score != null && <span className="ml-1 text-text-tertiary">({(s.score * 100).toFixed(0)}%)</span>}
                            </div>
                          </div>
                          <p className="text-xs text-text-secondary line-clamp-3 leading-relaxed">{s.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {m.entities && m.entities.length > 0 && !m.streaming && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.entities.slice(0, 8).map((e, j) => (
                    <button
                      key={`${e.id || e.name}-${j}`}
                      onClick={() => focusEntityInKg(e)}
                      className="text-xs px-1.5 py-0.5 rounded-full bg-surface-tertiary text-text-tertiary hover:text-accent transition-colors"
                      title="在知識圖譜中聚焦"
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && !messages[messages.length - 1]?.streaming && (
          <div className="flex justify-start">
            <div className="bg-panel border border-border rounded-xl px-3 py-2">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {showSuggested && messages.length <= 1 && (
          <div className="space-y-1.5">
            <p className="text-xs text-text-tertiary px-1">建議問題</p>
            {SUGGESTED.map((s, i) => (
              <button
                key={i}
                onClick={() => void handleSend(s)}
                disabled={loading}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-panel hover:bg-surface-tertiary border border-border text-text-secondary transition-colors disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-border flex-shrink-0 bg-surface-secondary">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="問問知識庫... (Enter 送出, Shift+Enter 換行)"
            rows={2}
            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent resize-none leading-relaxed"
          />
          <button
            onClick={() => void handleSend()}
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-accent hover:bg-accent-hover rounded-xl text-white text-sm disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {loading ? '⏹' : '→'}
          </button>
        </div>
        <p className="text-xs text-text-tertiary mt-1 px-1">模式：{MODE_LABEL[mode]} · Auto 會在 Hybrid 與 GraphRAG 間自動路由</p>
      </div>
    </div>
  );
}
