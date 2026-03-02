import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  startResearchAgent,
  startSummarizeAgent,
  startSupervisorAgent,
  startBrainstormAgent,
  startOutlineAgent,
  getToken,
  api,
  getAgentRunArtifacts,
  type AgentRunArtifactsResponse,
} from '../api/client';

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-text-tertiary',
  running: 'text-warning',
  done: 'text-success',
  error: 'text-error',
  aborted: 'text-text-tertiary',
};
const STATUS_ICON: Record<string, string> = {
  pending: '○', running: '◌', done: '✓', error: '✗', aborted: '⏹',
};

type AgentMode = 'research' | 'summarize' | 'brainstorm' | 'outline';

const MODE_CONFIG: Record<AgentMode, { icon: string; label: string; placeholder: string; desc: string }> = {
  research:   { icon: '🔬', label: 'Research',   placeholder: '輸入研究問題或主題...',    desc: '深度研究並整合知識庫資料' },
  summarize:  { icon: '📝', label: 'Summarize',  placeholder: '輸入要摘要的文字或主題...', desc: '智慧摘要，提取重點' },
  brainstorm: { icon: '💡', label: 'Brainstorm', placeholder: '輸入要發想的主題...',       desc: '腦力激盪，生成創意想法' },
  outline:    { icon: '📋', label: 'Outline',    placeholder: '輸入要生成大綱的主題...',   desc: '自動生成結構化大綱' },
};

interface Step {
  id?: string;
  step_key?: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted';
  output?: unknown;
  token_usage?: number;
}

interface RunState {
  id: string;
  status: 'running' | 'done' | 'error' | 'aborted';
  steps: Step[];
  type: AgentMode;
  result?: { answer?: string };
  started_at?: string;
  finished_at?: string;
  token_usage?: number;
}

interface StreamMeta {
  schemaVersion?: string;
  requestId?: string;
}

interface StreamEnvelope {
  type?: 'meta' | 'step' | 'token' | 'run' | 'error' | 'done';
  schema_version?: string;
  request_id?: string;
  step?: Step;
  token?: string;
  run?: RunState;
}

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const ESTIMATED_TOKEN_PRICE = 0.000002;

function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return '--';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function parseTimestamp(input?: string): number | null {
  if (!input) return null;
  const t = Date.parse(input);
  return Number.isFinite(t) ? t : null;
}

export default function AgentPanel({
  workspaceId,
  activeDoc,
  initialPrompt,
}: {
  workspaceId: string;
  activeDoc: any;
  initialPrompt?: string;
}) {
  const [mode, setMode] = useState<AgentMode>('research');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<RunState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [streamMeta, setStreamMeta] = useState<StreamMeta>({});
  const [artifacts, setArtifacts] = useState<AgentRunArtifactsResponse | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const lastInitialPromptRef = useRef<string | null>(null);

  useEffect(() => {
    const nextPrompt = initialPrompt?.trim();
    if (!nextPrompt) {
      lastInitialPromptRef.current = null;
      return;
    }
    if (lastInitialPromptRef.current === nextPrompt) return;
    lastInitialPromptRef.current = nextPrompt;
    setInput(nextPrompt);
  }, [initialPrompt]);

  const loadArtifacts = useCallback(async (runId: string) => {
    try {
      const result = await getAgentRunArtifacts(runId);
      setArtifacts(result);
    } catch (error) {
      console.warn('載入 run artifacts 失敗', error);
    }
  }, []);

  const closeStream = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      closeStream();
    };
  }, [closeStream]);

  const handleStart = useCallback(async () => {
    if (!input.trim() || !workspaceId || loading) return;
    setLoading(true);
    setSaved(false);
    setRun(null);
    setStreamingAnswer('');
    setStreamMeta({});
    setArtifacts(null);

    // Abort previous SSE
    closeStream();

    try {
      // Start the agent job
      let res: any;
      if (mode === 'research') {
        res = await startResearchAgent(input, workspaceId);
      } else if (mode === 'summarize') {
        res = await startSummarizeAgent(input, workspaceId);
      } else if (mode === 'brainstorm') {
        res = await startBrainstormAgent(input, workspaceId);
      } else if (mode === 'outline') {
        res = await startOutlineAgent(input, workspaceId);
      } else {
        res = await startSupervisorAgent(input, workspaceId, 'auto');
      }

      const runId = res.run_id;
      setRun({ id: runId, status: 'running', steps: [], type: mode, started_at: new Date().toISOString() });

      // Connect via SSE for real-time updates
      const token = getToken();
      const streamUrl = new URL(`/api/v1/agents/runs/${runId}/stream`, API_ORIGIN);
      if (token) streamUrl.searchParams.set('token', token);
      const es = new EventSource(streamUrl.toString());

      abortRef.current = () => es.close();

      let finalized = false;
      const finalizeStream = (nextStatus?: RunState['status']) => {
        if (finalized) return;
        finalized = true;
        es.close();
        setLoading(false);
        abortRef.current = null;
        if (nextStatus) {
          setRun((prev) => (prev ? { ...prev, status: nextStatus } : prev));
        }
        void loadArtifacts(runId);
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as StreamEnvelope;
          const eventType = data.type;

          if (!eventType) return;

          if (data.schema_version || data.request_id) {
            setStreamMeta((prev) => ({
              schemaVersion: data.schema_version ?? prev.schemaVersion,
              requestId: data.request_id ?? prev.requestId,
            }));
          }

          if (eventType === 'meta') {
            return;
          }

          if (eventType === 'step' && data.step) {
            const incomingStep = data.step;
            setRun(prev => {
              if (!prev) return prev;
              const incomingKey = incomingStep.id ?? incomingStep.step_key ?? incomingStep.name;
              const existingIdx = prev.steps.findIndex((s) => {
                const currentKey = s.id ?? s.step_key ?? s.name;
                return currentKey === incomingKey;
              });
              const newSteps = [...prev.steps];
              if (existingIdx >= 0) {
                newSteps[existingIdx] = { ...newSteps[existingIdx], ...incomingStep };
              } else {
                newSteps.push(incomingStep);
              }
              return { ...prev, steps: newSteps };
            });
          } else if (eventType === 'token') {
            setStreamingAnswer(prev => prev + (data.token || ''));
          } else if (eventType === 'run' && data.run) {
            const completedRun = data.run;
            setRun(completedRun);
            setStreamingAnswer((prev) => prev || completedRun.result?.answer || '');
          } else if (eventType === 'error') {
            setRun((prev) => (prev ? { ...prev, status: 'error' } : prev));
            finalizeStream('error');
          } else if (eventType === 'done') {
            finalizeStream();
          }
        } catch {
          // ignore malformed SSE payload
        }
      };

      es.addEventListener('done', () => {
        finalizeStream();
      });

      es.onerror = () => {
        finalizeStream('error');
      };

    } catch (err) {
      setLoading(false);
    }
  }, [input, workspaceId, loading, mode, loadArtifacts, closeStream]);

  const handleStop = () => {
    closeStream();
    setLoading(false);
    setRun(prev => prev ? { ...prev, status: 'aborted' } : null);
  };

  const handleSaveToDoc = async () => {
    const answer = run?.result?.answer || streamingAnswer;
    if (!answer || !workspaceId) return;
    const cfg = MODE_CONFIG[mode];
    const title = `${cfg.icon} ${cfg.label}：${input.slice(0, 30)}`;
    try {
      await api(`/documents`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspaceId,
          title,
          content: { text: answer },
        }),
      });
      setSaved(true);
    } catch { alert('儲存失敗'); }
  };

  const handleUseDoc = () => {
    if (activeDoc) {
      setInput(activeDoc.title || '');
    }
  };

  const finalAnswer = run?.result?.answer || (streamingAnswer.length > 0 ? streamingAnswer : undefined);
  const isAnimating = streamingAnswer.length > 0 && streamingAnswer !== run?.result?.answer;

  const telemetry = useMemo(() => {
    const stepTokenSum = run?.steps.reduce((sum, step) => sum + (step.token_usage ?? 0), 0) ?? 0;
    const artifactTokenSum = artifacts?.timeline.reduce((sum, artifact) => {
      if (artifact.artifact_type !== 'status') return sum;
      const tokenUsage = Number(artifact.payload?.token_usage ?? 0);
      return sum + (Number.isFinite(tokenUsage) ? tokenUsage : 0);
    }, 0) ?? 0;

    const tokens = Math.max(run?.token_usage ?? 0, stepTokenSum, artifactTokenSum);
    const startTs = parseTimestamp(run?.started_at);
    const endTs = parseTimestamp(run?.finished_at) ?? (run?.status === 'running' ? Date.now() : null);
    const latencySeconds =
      startTs != null && endTs != null && endTs >= startTs
        ? (endTs - startTs) / 1000
        : undefined;
    const cost = tokens > 0 ? tokens * ESTIMATED_TOKEN_PRICE : undefined;

    return {
      tokens,
      latencySeconds,
      cost,
      timelineCount: artifacts?.timeline.length ?? 0,
    };
  }, [artifacts, run]);

  return (
    <div className="flex flex-col h-full p-3 gap-3 bg-surface">
      {/* 模式選擇 */}
      <div className="grid grid-cols-4 gap-1 bg-surface-tertiary rounded-xl p-1 border border-border">
        {(Object.entries(MODE_CONFIG) as [AgentMode, typeof MODE_CONFIG[AgentMode]][]).map(([m, cfg]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={cfg.desc}
            className={`py-1.5 text-xs rounded-lg transition-all flex flex-col items-center gap-0.5 ${
              mode === m ? 'bg-accent text-white shadow-sm' : 'text-text-tertiary hover:text-text-primary hover:bg-surface'
            }`}
          >
            <span className="text-sm">{cfg.icon}</span>
            <span className="text-[10px] leading-tight">{cfg.label}</span>
          </button>
        ))}
      </div>

      {/* 當前模式說明 */}
      <p className="text-xs text-text-tertiary -mt-1 px-1">{MODE_CONFIG[mode].desc}</p>

      {/* 輸入 */}
      <div className="space-y-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={MODE_CONFIG[mode].placeholder}
          rows={3}
          className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent resize-none"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStart();
          }}
        />
        <div className="flex gap-2 items-center">
          {activeDoc && (
            <button
              onClick={handleUseDoc}
              className="text-xs text-text-tertiary hover:text-accent transition-colors underline underline-offset-2 truncate max-w-[120px]"
              title={`使用「${activeDoc.title}」作為輸入`}
            >
              使用「{activeDoc.title?.slice(0, 12)}...」
            </button>
          )}
          <div className="flex-1" />
          <span className="text-xs text-text-tertiary">⌘Enter</span>
          {loading ? (
            <button
              onClick={handleStop}
              className="px-3 py-1.5 bg-error-light hover:bg-error/10 border border-error/20 rounded-lg text-error text-xs transition-colors"
            >⏹ 停止</button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!input.trim()}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover rounded-lg text-white text-sm disabled:opacity-40 transition-colors"
            >▶ 執行</button>
          )}
        </div>
      </div>

      {/* 執行進度 */}
      {run && (
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {/* Run header */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-mono">#{run.id?.slice(0, 8)}</span>
            <div className="flex items-center gap-1.5">
              {loading && (
                <div className="w-3 h-3 border border-warning border-t-transparent rounded-full animate-spin" />
              )}
              <span className={`text-xs font-medium ${STATUS_COLOR[run.status]}`}>
                {run.status === 'running'
                  ? '執行中...'
                  : run.status === 'done'
                    ? '✓ 完成'
                    : run.status === 'aborted'
                      ? '⏹ 已停止'
                      : '✗ 錯誤'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="px-2 py-1 rounded-lg bg-surface-secondary border border-border text-text-tertiary">
              Tokens：<span className="text-text-secondary font-medium">{telemetry.tokens > 0 ? telemetry.tokens.toLocaleString() : '--'}</span>
            </div>
            <div className="px-2 py-1 rounded-lg bg-surface-secondary border border-border text-text-tertiary">
              延遲：<span className="text-text-secondary font-medium">{formatDuration(telemetry.latencySeconds)}</span>
            </div>
            <div className="px-2 py-1 rounded-lg bg-surface-secondary border border-border text-text-tertiary">
              估算成本：<span className="text-text-secondary font-medium">{telemetry.cost != null ? `$${telemetry.cost.toFixed(4)}` : '--'}</span>
            </div>
            <div className="px-2 py-1 rounded-lg bg-surface-secondary border border-border text-text-tertiary">
              Telemetry：
              <span className="text-text-secondary font-medium">
                {telemetry.timelineCount > 0
                  ? `${telemetry.timelineCount} events`
                  : 'stream only'}
              </span>
            </div>
          </div>

          {(streamMeta.schemaVersion || streamMeta.requestId) && (
            <div className="text-[10px] text-text-quaternary px-1 flex flex-wrap gap-2">
              {streamMeta.schemaVersion && <span>SSE schema {streamMeta.schemaVersion}</span>}
              {streamMeta.requestId && <span>req {streamMeta.requestId.slice(0, 12)}</span>}
            </div>
          )}

          {/* Steps */}
          {run.steps.map((step, i) => (
            <div key={i} className="bg-panel border border-border rounded-xl p-3">
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

          {/* Final Answer with streaming effect */}
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
                  {saved ? '✓ 已儲存' : '💾 存為文件'}
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

      {/* Empty state */}
      {!run && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-tertiary">
            <div className="text-3xl mb-2">🤖</div>
            <p className="text-xs">選擇模式並輸入任務</p>
            <p className="text-xs mt-1 text-text-secondary">⌘Enter 快速執行</p>
            <div className="grid grid-cols-2 gap-2 mt-3 text-left">
              {Object.entries(MODE_CONFIG).map(([m, cfg]) => (
                <button
                  key={m}
                  onClick={() => setMode(m as AgentMode)}
                  className="text-xs p-2 bg-panel hover:bg-surface-tertiary border border-border rounded-lg text-text-tertiary hover:text-text-primary transition-colors text-left"
                >
                  <div className="text-sm mb-0.5">{cfg.icon}</div>
                  <div className="font-medium text-text-secondary">{cfg.label}</div>
                  <div className="text-text-tertiary text-[10px] mt-0.5 leading-tight">{cfg.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
