import React, { useState, useRef, useCallback } from 'react';
import { startResearchAgent, startSummarizeAgent, startSupervisorAgent, sseStream, api } from '../api/client';

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-text-tertiary',
  running: 'text-warning',
  done: 'text-success',
  error: 'text-error',
};

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  running: '◔',
  done: '●',
  error: '✕',
};

type AgentMode = 'research' | 'summarize' | 'brainstorm' | 'outline';

const MODE_CONFIG: Record<AgentMode, { icon: string; label: string; placeholder: string; desc: string }> = {
  research: {
    icon: '🔎',
    label: 'Research',
    placeholder: '輸入要研究的主題...',
    desc: '收集資料並整理重點。',
  },
  summarize: {
    icon: '📝',
    label: 'Summarize',
    placeholder: '輸入要摘要的內容...',
    desc: '快速整理內容摘要。',
  },
  brainstorm: {
    icon: '💡',
    label: 'Brainstorm',
    placeholder: '輸入要發想的題目...',
    desc: '展開點子與可能方向。',
  },
  outline: {
    icon: '📚',
    label: 'Outline',
    placeholder: '輸入要整理的大綱主題...',
    desc: '建立結構化大綱。',
  },
};

interface Step {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string | Record<string, unknown>;
}

interface RunState {
  id: string;
  status: 'running' | 'done' | 'error';
  steps: Step[];
  type: AgentMode;
  result?: { answer?: string };
}

export default function AgentPanel({
  workspaceId,
  activeDoc,
}: {
  workspaceId: string;
  activeDoc: any;
}) {
  const [mode, setMode] = useState<AgentMode>('research');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<RunState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const abortRef = useRef<(() => void) | null>(null);
  const streamingAnswerRef = useRef('');

  const updateStreamingAnswer = useCallback((updater: (prev: string) => string) => {
    setStreamingAnswer((prev) => {
      const next = updater(prev);
      streamingAnswerRef.current = next;
      return next;
    });
  }, []);

  const handleStart = useCallback(async () => {
    if (!input.trim() || !workspaceId || loading) return;

    setLoading(true);
    setSaved(false);
    setRun(null);
    streamingAnswerRef.current = '';
    setStreamingAnswer('');

    abortRef.current?.();

    try {
      let res: { run_id: string };
      if (mode === 'research') {
        res = await startResearchAgent(input, workspaceId);
      } else if (mode === 'summarize') {
        res = await startSummarizeAgent(input, workspaceId);
      } else {
        res = await startSupervisorAgent(input, workspaceId, 'auto');
      }

      const runId = res.run_id;
      setRun({ id: runId, status: 'running', steps: [], type: mode });

      const stop = sseStream(
        `/api/v1/agents/runs/${runId}/stream`,
        (data) => {
          if (data.type === 'step') {
            setRun((prev) => {
              if (!prev) return prev;
              const existingIdx = prev.steps.findIndex((step) => step.name === data.step.name);
              const newSteps = [...prev.steps];
              if (existingIdx >= 0) newSteps[existingIdx] = data.step;
              else newSteps.push(data.step);
              return { ...prev, steps: newSteps };
            });
            return;
          }

          if (data.type === 'token') {
            updateStreamingAnswer((prev) => prev + (data.token || ''));
            return;
          }

          if (data.type === 'run') {
            const completedRun = data.run as RunState;
            setRun(completedRun);
            if (!streamingAnswerRef.current && completedRun.result?.answer) {
              updateStreamingAnswer(() => completedRun.result?.answer || '');
            }
          }
        },
        () => {
          setLoading(false);
          abortRef.current = null;
        },
        () => {
          setLoading(false);
          abortRef.current = null;
          setRun((prev) => (prev ? { ...prev, status: 'error' } : prev));
        }
      );

      abortRef.current = stop;
    } catch {
      setLoading(false);
    }
  }, [input, workspaceId, loading, mode, updateStreamingAnswer]);

  const handleStop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setLoading(false);
    setRun((prev) => (prev ? { ...prev, status: 'error' } : null));
  }, []);

  const handleSaveToDoc = useCallback(async () => {
    const answer = run?.result?.answer || streamingAnswerRef.current;
    if (!answer || !workspaceId) return;

    const cfg = MODE_CONFIG[mode];
    const title = `${cfg.icon} ${cfg.label}: ${input.slice(0, 30)}`;
    try {
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspaceId,
          title,
          content: { text: answer },
        }),
      });
      setSaved(true);
    } catch {
      alert('儲存失敗');
    }
  }, [input, mode, run?.result?.answer, workspaceId]);

  const handleUseDoc = useCallback(() => {
    if (activeDoc) {
      setInput(activeDoc.title || '');
    }
  }, [activeDoc]);

  const finalAnswer = run?.result?.answer || (streamingAnswer.length > 0 ? streamingAnswer : undefined);
  const isAnimating = streamingAnswer.length > 0 && streamingAnswer !== run?.result?.answer;

  return (
    <div className="flex flex-col h-full p-3 gap-3 bg-surface">
      <div className="grid grid-cols-4 gap-1 bg-surface-tertiary rounded-xl p-1 border border-border">
        {(Object.entries(MODE_CONFIG) as [AgentMode, typeof MODE_CONFIG[AgentMode]][]).map(([nextMode, cfg]) => (
          <button
            key={nextMode}
            onClick={() => setMode(nextMode)}
            title={cfg.desc}
            className={`py-1.5 text-xs rounded-lg transition-all flex flex-col items-center gap-0.5 ${
              mode === nextMode ? 'bg-accent text-white shadow-sm' : 'text-text-tertiary hover:text-text-primary hover:bg-surface'
            }`}
          >
            <span className="text-sm">{cfg.icon}</span>
            <span className="text-[10px] leading-tight">{cfg.label}</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-text-tertiary -mt-1 px-1">{MODE_CONFIG[mode].desc}</p>

      <div className="space-y-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={MODE_CONFIG[mode].placeholder}
          rows={3}
          className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStart();
          }}
        />
        <div className="flex gap-2 items-center">
          {activeDoc && (
            <button
              onClick={handleUseDoc}
              className="text-xs text-text-tertiary hover:text-accent transition-colors underline underline-offset-2 truncate max-w-[140px]"
              title={`使用文件：${activeDoc.title}`}
            >
              使用文件：{String(activeDoc.title ?? '').slice(0, 12)}
            </button>
          )}
          <div className="flex-1" />
          <span className="text-xs text-text-tertiary">Cmd/Ctrl+Enter</span>
          {loading ? (
            <button
              onClick={handleStop}
              className="px-3 py-1.5 bg-error-light hover:bg-error/10 border border-error/20 rounded-lg text-error text-xs transition-colors"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!input.trim()}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover rounded-lg text-white text-sm disabled:opacity-40 transition-colors"
            >
              開始
            </button>
          )}
        </div>
      </div>

      {run && (
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-mono">#{run.id?.slice(0, 8)}</span>
            <div className="flex items-center gap-1.5">
              {loading && <div className="w-3 h-3 border border-warning border-t-transparent rounded-full animate-spin" />}
              <span className={`text-xs font-medium ${STATUS_COLOR[run.status]}`}>
                {run.status === 'running' ? '執行中...' : run.status === 'done' ? '完成' : '錯誤'}
              </span>
            </div>
          </div>

          {run.steps.map((step, index) => (
            <div key={`${step.name}-${index}`} className="bg-panel border border-border rounded-xl p-3">
              <div className="flex items-center gap-2">
                {step.status === 'running' ? (
                  <div className="w-3 h-3 border border-warning border-t-transparent rounded-full animate-spin flex-shrink-0" />
                ) : (
                  <span className={`text-sm font-mono flex-shrink-0 ${STATUS_COLOR[step.status]}`}>
                    {STATUS_ICON[step.status]}
                  </span>
                )}
                <span className="text-xs text-text-secondary flex-1">{step.name}</span>
              </div>
              {step.status === 'done' && step.output && (
                <p className="text-xs text-text-tertiary mt-1.5 line-clamp-2 pl-5">
                  {typeof step.output === 'string' ? step.output : JSON.stringify(step.output).slice(0, 120)}
                </p>
              )}
            </div>
          ))}

          {finalAnswer && (
            <div className="bg-accent-light border border-accent-muted rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-accent">
                  {MODE_CONFIG[run.type]?.icon} 最終結果
                </p>
                <button
                  onClick={handleSaveToDoc}
                  disabled={saved || isAnimating}
                  className="text-xs px-2 py-0.5 bg-accent-muted hover:bg-accent-light text-accent rounded-lg disabled:opacity-40 transition-colors"
                >
                  {saved ? '已儲存' : '存成文件'}
                </button>
              </div>
              <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
                {finalAnswer}
                {isAnimating && (
                  <span className="inline-block w-0.5 h-3.5 bg-accent animate-pulse ml-0.5 align-middle" />
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {!run && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-tertiary">
            <div className="text-3xl mb-2">🤖</div>
            <p className="text-xs">選擇模式並輸入問題</p>
            <p className="text-xs mt-1 text-text-secondary">按 Cmd/Ctrl+Enter 開始</p>
          </div>
        </div>
      )}
    </div>
  );
}
