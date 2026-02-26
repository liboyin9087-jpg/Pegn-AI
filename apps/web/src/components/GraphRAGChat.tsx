import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getToken } from '../api/client';

interface Source {
  content: string;
  document_title?: string;
  title?: string;
  score?: number;
}

interface Msg {
  role: 'user' | 'ai';
  text: string;
  streaming?: boolean;
  sources?: Source[];
  entities?: any[];
}

const SUGGESTED = [
  '幫我整理這份工作區的重點',
  '有哪些重要概念需要了解？',
  '列出所有提到的人名或組織',
  '分析文件中的主要論點',
  '幫我做一份摘要',
  '有哪些待辦事項或行動計畫？',
];

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
      text: '你好！我是 AI 助理，可以根據你的工作區知識回答問題。\n\n你可以問我任何關於文件的問題，或使用下方的建議問題快速開始。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggested, setShowSuggested] = useState(true);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (q?: string) => {
    const query = (q ?? input).trim();
    if (!query || loading || !workspaceId) return;

    setInput('');
    setShowSuggested(false);
    setMessages(prev => [...prev, { role: 'user', text: query }]);
    setLoading(true);

    // Add placeholder AI message for streaming
    const aiMsgIndex = messages.length + 1;
    setMessages(prev => [...prev, { role: 'ai', text: '', streaming: true }]);

    // Abort previous stream
    abortRef.current?.();

    try {
      const token = getToken();
      const res = await fetch('http://localhost:4000/api/v1/graphrag/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, workspace_id: workspaceId }),
        signal: new AbortController().signal,
      });

      if (!res.ok || !res.body) {
        throw new Error('Stream failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let sources: Source[] = [];
      let entities: any[] = [];

      abortRef.current = () => reader.cancel();

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
            } else if (data.type === 'token') {
              accumulated += data.token;
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last.role === 'ai') {
                  next[next.length - 1] = { ...last, text: accumulated, streaming: true };
                }
                return next;
              });
            } else if (data.type === 'done') {
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last.role === 'ai') {
                  next[next.length - 1] = {
                    ...last,
                    text: accumulated,
                    streaming: false,
                    sources,
                    entities,
                  };
                }
                return next;
              });
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          } catch (parseErr) {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.role === 'ai') {
            next[next.length - 1] = {
              ...last,
              text: '查詢失敗，請確認後端服務正常。',
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
  }, [input, loading, workspaceId, messages.length]);

  const handleClear = () => {
    setMessages([{
      role: 'ai',
      text: '對話已清除。有什麼我可以幫你的嗎？',
    }]);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs text-text-tertiary">
          {messages.length - 1} 則對話
          {activeDoc && <span className="text-accent"> · {activeDoc.title}</span>}
        </span>
        <button
          onClick={handleClear}
          className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          title="清除對話記錄"
        >🗑 清除</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${
              m.role === 'user'
                ? 'bg-accent text-white rounded-br-sm'
                : 'bg-panel border border-border text-text-primary rounded-bl-sm'
            }`}>
              {/* Message text */}
              <p className="whitespace-pre-wrap leading-relaxed">{m.text}
                {m.streaming && (
                  <span className="inline-block w-0.5 h-4 bg-accent animate-pulse ml-0.5 align-middle" />
                )}
              </p>

              {/* Sources */}
              {m.sources && m.sources.length > 0 && !m.streaming && (
                <div className="mt-2 pt-2 border-t border-border">
                  <button
                    onClick={() => toggleSources(i)}
                    className="text-xs text-text-tertiary hover:text-text-secondary flex items-center gap-1 transition-colors"
                  >
                    <span>{expandedSources.has(i) ? '▼' : '▶'}</span>
                    來源 ({m.sources.length} 個片段)
                  </button>
                  {expandedSources.has(i) && (
                    <div className="mt-2 space-y-1.5">
                      {m.sources.slice(0, 5).map((s, j) => (
                        <div key={j} className="bg-surface-secondary rounded-lg p-2 border border-border hover:border-accent/50 transition-colors group">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-xs font-medium text-accent truncate flex-1">
                              [{j+1}] {s.document_title || s.title || '未命名文件'}
                              {s.score != null && (
                                <span className="ml-1 text-text-tertiary">({(s.score * 100).toFixed(0)}%)</span>
                              )}
                            </div>
                            <button className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity hover:text-accent">
                              查看原文
                            </button>
                          </div>
                          <p className="text-xs text-text-secondary line-clamp-3 leading-relaxed">{s.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Entities */}
              {m.entities && m.entities.length > 0 && !m.streaming && expandedSources.has(i) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.entities.slice(0, 6).map((e: any, j: number) => (
                    <span
                      key={j}
                      className="text-xs px-1.5 py-0.5 rounded-full bg-surface-tertiary text-text-tertiary"
                    >
                      {e.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading dots */}
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

        {/* Suggested questions */}
        {showSuggested && messages.length <= 1 && (
          <div className="space-y-1.5">
            <p className="text-xs text-text-tertiary px-1">💡 建議問題</p>
            {SUGGESTED.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSend(s)}
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

      {/* Input */}
      <div className="p-3 border-t border-border flex-shrink-0 bg-surface-secondary">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="問問 GraphRAG... (Enter 送出, Shift+Enter 換行)"
            rows={2}
            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent resize-none leading-relaxed"
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-accent hover:bg-accent-hover rounded-xl text-white text-sm disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {loading ? '⏹' : '→'}
          </button>
        </div>
        <p className="text-xs text-text-tertiary mt-1 px-1">GraphRAG 融合語意向量 + BM25 + 知識圖譜</p>
      </div>
    </div>
  );
}
