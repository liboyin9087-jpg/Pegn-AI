/**
 * AutomationPanel.tsx — Visual Automation Builder
 *
 * Provides a UI for creating and managing workspace automations:
 *   - List automations with status (enabled/disabled)
 *   - Create automation: pick trigger → set conditions → add actions
 *   - View run history per automation
 *   - Manual trigger button
 *   - Enable/disable toggle
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap, Plus, Play, Trash2, ChevronDown, ChevronRight,
  ToggleLeft, ToggleRight, History, X, CheckCircle2,
  AlertCircle, Clock, Loader2,
} from 'lucide-react';
import { api, triggerAutomationJob, type AutomationTriggerResponse } from '../api/client';
import type { WorkspaceMembershipSummary } from '../api/client';
import { useOptionalAppContext } from '../contexts/AppContext';
import EmptyState from './EmptyState';
import ForbiddenState from './ForbiddenState';
import LoadingSkeleton from './LoadingSkeleton';

// ── Types ────────────────────────────────────────────────────────────────

type TriggerType =
  | 'doc_created' | 'doc_updated' | 'doc_deleted'
  | 'property_changed' | 'status_changed'
  | 'comment_created' | 'schedule';

type ActionType = 'run_agent' | 'send_webhook' | 'notify' | 'update_property';

interface ActionConfig {
  type: ActionType;
  config: Record<string, any>;
}

interface Automation {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, any>;
  conditions: any[];
  actions: ActionConfig[];
  schedule_cron: string | null;
  run_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

interface AutomationRun {
  id: string;
  triggered_by: string;
  status: 'running' | 'done' | 'error' | 'skipped';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS: { value: TriggerType; label: string; icon: string; desc: string }[] = [
  { value: 'doc_created',     icon: '📄', label: '文件建立時',   desc: '有新頁面或文件被建立' },
  { value: 'doc_updated',     icon: '✏️', label: '文件更新時',   desc: '文件內容被修改' },
  { value: 'doc_deleted',     icon: '🗑️', label: '文件刪除時',   desc: '文件被刪除' },
  { value: 'property_changed', icon: '🔧', label: '屬性變更時',   desc: '資料庫欄位值改變' },
  { value: 'status_changed',  icon: '🔄', label: '狀態變更時',   desc: '狀態欄位切換' },
  { value: 'comment_created', icon: '💬', label: '留言建立時',   desc: '有新評論被建立' },
  { value: 'schedule',        icon: '⏰', label: '定時執行',     desc: '依設定週期自動執行' },
];

const ACTION_OPTIONS: { value: ActionType; label: string; icon: string; desc: string }[] = [
  { value: 'run_agent',       icon: '🤖', label: '執行 AI Agent',  desc: '自動啟動 AI 工作流程' },
  { value: 'send_webhook',    icon: '🔗', label: '發送 Webhook',   desc: '呼叫外部服務 URL' },
  { value: 'notify',          icon: '🔔', label: '發送通知',       desc: '在 Inbox 通知工作區成員' },
  { value: 'update_property', icon: '📝', label: '更新屬性',       desc: '自動修改資料庫欄位' },
];

const SCHEDULE_OPTIONS = [
  { value: 'every_5_minutes',  label: '每 5 分鐘' },
  { value: 'every_15_minutes', label: '每 15 分鐘' },
  { value: 'every_60_minutes', label: '每 1 小時' },
  { value: 'every_day',        label: '每天' },
];

const STATUS_STYLES: Record<string, { color: string; icon: React.ReactNode }> = {
  done:    { color: 'text-success', icon: <CheckCircle2 size={11} /> },
  error:   { color: 'text-error',   icon: <AlertCircle size={11} /> },
  running: { color: 'text-warning', icon: <Loader2 size={11} className="animate-spin" /> },
  skipped: { color: 'text-text-tertiary', icon: <Clock size={11} /> },
};

// ── API helpers ───────────────────────────────────────────────────────────

async function listAutomations(workspaceId: string): Promise<Automation[]> {
  const res = await api<{ automations: Automation[] }>(`/automations?workspace_id=${workspaceId}`);
  return res.automations;
}

async function createAutomation(data: Partial<Automation> & { workspace_id: string }): Promise<Automation> {
  return api<Automation>('/automations', { method: 'POST', body: JSON.stringify(data) });
}

async function toggleAutomation(id: string, enabled: boolean): Promise<Automation> {
  return api<Automation>(`/automations/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
}

async function deleteAutomation(id: string): Promise<void> {
  await api(`/automations/${id}`, { method: 'DELETE' });
}

async function triggerAutomation(id: string): Promise<AutomationTriggerResponse> {
  return triggerAutomationJob(id);
}

async function getRunHistory(id: string): Promise<AutomationRun[]> {
  const res = await api<{ runs: AutomationRun[] }>(`/automations/${id}/runs?limit=10`);
  return res.runs;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-quaternary)', marginBottom: 6 }}>
      {children}
    </p>
  );
}

function RunHistoryPanel({ automationId, onClose }: { automationId: string; onClose: () => void }) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRunHistory(automationId)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [automationId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="absolute right-0 top-full mt-1 z-30 rounded-xl overflow-hidden shadow-xl"
      style={{ width: 300, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>執行歷史</span>
        <button onClick={onClose}><X size={13} style={{ color: 'var(--color-text-tertiary)' }} /></button>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
        {loading && <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-accent)' }} /></div>}
        {!loading && runs.length === 0 && (
          <div className="py-6 text-center" style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            尚無執行紀錄
          </div>
        )}
        {runs.map(run => {
          const st = STATUS_STYLES[run.status] || STATUS_STYLES.skipped;
          return (
            <div key={run.id} className="px-3 py-2 border-b border-border" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <div className="flex items-center justify-between mb-0.5">
                <div className={`flex items-center gap-1 ${st.color}`} style={{ fontSize: 11, fontWeight: 500 }}>
                  {st.icon}
                  <span className="capitalize">{run.status === 'done' ? '成功' : run.status === 'error' ? '失敗' : run.status === 'running' ? '執行中' : '略過'}</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                  {run.duration_ms != null ? `${run.duration_ms}ms` : '—'}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                {new Date(run.started_at).toLocaleString('zh-TW')}
                {' · '}{run.triggered_by === 'manual' ? '手動' : run.triggered_by === 'schedule' ? '排程' : '事件'}
              </div>
              {run.error && <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 2 }} className="truncate">{run.error}</div>}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Create Form ────────────────────────────────────────────────────────────

interface CreateFormProps {
  workspaceId: string;
  onCreated: (a: Automation) => void;
  onCancel: () => void;
}

function CreateForm({ workspaceId, onCreated, onCancel }: CreateFormProps) {
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('doc_created');
  const [scheduleCron, setScheduleCron] = useState('every_60_minutes');
  const [actions, setActions] = useState<ActionConfig[]>([{ type: 'notify', config: { title: '自動化通知', message: '自動化已觸發。' } }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addAction = () => {
    setActions(prev => [...prev, { type: 'notify', config: { title: '', message: '' } }]);
  };

  const updateAction = (i: number, partial: Partial<ActionConfig>) => {
    setActions(prev => prev.map((a, idx) => idx === i ? { ...a, ...partial } : a));
  };

  const removeAction = (i: number) => {
    setActions(prev => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('請輸入自動化名稱'); return; }
    if (actions.length === 0) { setError('請至少新增一個動作'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: any = {
        workspace_id: workspaceId,
        name: name.trim(),
        trigger_type: triggerType,
        actions,
        enabled: true,
      };
      if (triggerType === 'schedule') payload.schedule_cron = scheduleCron;
      const created = await createAutomation(payload);
      onCreated(created);
    } catch (e: any) {
      setError(e.message || '建立失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="rounded-2xl p-4 mb-4"
      style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>新增自動化</h3>
        <button onClick={onCancel}><X size={14} style={{ color: 'var(--color-text-tertiary)' }} /></button>
      </div>

      {/* Name */}
      <div className="mb-3">
        <SectionLabel>名稱</SectionLabel>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="例：文件建立時自動通知成員"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontSize: 13 }}
        />
      </div>

      {/* Trigger */}
      <div className="mb-3">
        <SectionLabel>觸發條件</SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {TRIGGER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTriggerType(opt.value)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors"
              style={{
                background: triggerType === opt.value ? 'var(--color-accent-light)' : 'var(--color-surface)',
                border: `1px solid ${triggerType === opt.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: triggerType === opt.value ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              }}
            >
              <span>{opt.icon}</span>
              <span style={{ fontSize: 11.5, fontWeight: 500 }}>{opt.label}</span>
            </button>
          ))}
        </div>
        {triggerType === 'schedule' && (
          <select
            value={scheduleCron}
            onChange={e => setScheduleCron(e.target.value)}
            className="mt-2 w-full px-2 py-1.5 rounded-lg text-xs outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            {SCHEDULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      {/* Actions */}
      <div className="mb-3">
        <SectionLabel>執行動作</SectionLabel>
        <div className="space-y-2">
          {actions.map((action, i) => (
            <div key={i} className="rounded-lg p-2.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <select
                  value={action.type}
                  onChange={e => updateAction(i, { type: e.target.value as ActionType, config: {} })}
                  className="text-xs rounded px-2 py-1 outline-none"
                  style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                >
                  {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
                </select>
                <button onClick={() => removeAction(i)}>
                  <X size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              </div>

              {/* Action-specific config */}
              {action.type === 'notify' && (
                <div className="space-y-1.5">
                  <input
                    value={action.config.title || ''}
                    onChange={e => updateAction(i, { config: { ...action.config, title: e.target.value } })}
                    placeholder="通知標題"
                    className="w-full px-2 py-1 rounded text-xs outline-none"
                    style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  />
                  <input
                    value={action.config.message || ''}
                    onChange={e => updateAction(i, { config: { ...action.config, message: e.target.value } })}
                    placeholder="通知內容"
                    className="w-full px-2 py-1 rounded text-xs outline-none"
                    style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  />
                </div>
              )}
              {action.type === 'run_agent' && (
                <div className="space-y-1.5">
                  <select
                    value={action.config.template || 'summarize'}
                    onChange={e => updateAction(i, { config: { ...action.config, template: e.target.value } })}
                    className="w-full px-2 py-1 rounded text-xs outline-none"
                    style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  >
                    <option value="summarize">摘要（Summarize）</option>
                    <option value="research">研究（Research）</option>
                    <option value="brainstorm">腦力激盪（Brainstorm）</option>
                    <option value="outline">大綱（Outline）</option>
                  </select>
                  <input
                    value={action.config.input || ''}
                    onChange={e => updateAction(i, { config: { ...action.config, input: e.target.value } })}
                    placeholder="Agent 輸入（可留空使用預設）"
                    className="w-full px-2 py-1 rounded text-xs outline-none"
                    style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  />
                </div>
              )}
              {action.type === 'send_webhook' && (
                <input
                  value={action.config.url || ''}
                  onChange={e => updateAction(i, { config: { url: e.target.value } })}
                  placeholder="https://example.com/webhook"
                  className="w-full px-2 py-1 rounded text-xs outline-none"
                  style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                />
              )}
              {action.type === 'update_property' && (
                <div className="space-y-1.5">
                  <input
                    value={action.config.property_key || ''}
                    onChange={e => updateAction(i, { config: { ...action.config, property_key: e.target.value } })}
                    placeholder="屬性名稱（如 status）"
                    className="w-full px-2 py-1 rounded text-xs outline-none"
                    style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  />
                  <input
                    value={String(action.config.property_value || '')}
                    onChange={e => updateAction(i, { config: { ...action.config, property_value: e.target.value } })}
                    placeholder="新值"
                    className="w-full px-2 py-1 rounded text-xs outline-none"
                    style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                  />
                </div>
              )}
            </div>
          ))}
          <button
            onClick={addAction}
            className="flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg text-xs transition-colors"
            style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)', background: 'transparent' }}
          >
            <Plus size={11} /> 新增動作
          </button>
        </div>
      </div>

      {error && <p style={{ fontSize: 11, color: 'var(--color-error)', marginBottom: 8 }}>{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--color-accent)', color: '#fff', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
          {saving ? '建立中...' : '建立自動化'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm transition-colors"
          style={{ background: 'var(--color-surface-tertiary)', color: 'var(--color-text-secondary)' }}
        >
          取消
        </button>
      </div>
    </motion.div>
  );
}

// ── Automation Card ────────────────────────────────────────────────────────

function AutomationCard({ automation, onToggle, onDelete, onTrigger, canRunAutomation, lastTriggeredJobId, onOpenJob }: {
  automation: Automation;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  canRunAutomation: boolean;
  lastTriggeredJobId?: string | null;
  onOpenJob?: (jobId: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const trigger = TRIGGER_OPTIONS.find(t => t.value === automation.trigger_type);

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger(automation.id);
    } finally {
      setTimeout(() => setTriggering(false), 1500);
    }
  };

  return (
    <div
      className="rounded-xl transition-all"
      style={{
        background: automation.enabled ? 'var(--color-surface)' : 'var(--color-surface-secondary)',
        border: `1px solid ${automation.enabled ? 'var(--color-border)' : 'var(--color-border-subtle)'}`,
        opacity: automation.enabled ? 1 : 0.7,
      }}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span>{trigger?.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }} className="truncate">
                {automation.name}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                style={{ fontSize: 10, background: 'var(--color-surface-tertiary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}
              >
                {trigger?.label}
              </span>
              {automation.actions.map((a, i) => {
                const ao = ACTION_OPTIONS.find(x => x.value === a.type);
                return (
                  <span key={i}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                    style={{ fontSize: 10, background: 'var(--color-accent-light)', color: 'var(--color-accent)', border: '1px solid var(--color-accent-muted, rgba(35,131,226,0.2))' }}
                  >
                    {ao?.icon} {ao?.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Toggle */}
          <button
            onClick={() => onToggle(automation.id, !automation.enabled)}
            disabled={!canRunAutomation}
            title={automation.enabled ? '停用' : '啟用'}
            className="flex-shrink-0 mt-0.5"
          >
            {automation.enabled
              ? <ToggleRight size={20} style={{ color: 'var(--color-accent)' }} />
              : <ToggleLeft size={20} style={{ color: 'var(--color-text-tertiary)' }} />
            }
          </button>
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between mt-2.5 pt-2" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            執行 {automation.run_count} 次
            {automation.last_triggered_at && (
              <> · 最後 {new Date(automation.last_triggered_at).toLocaleDateString('zh-TW')}</>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* History */}
            <div className="relative">
              <button
                onClick={() => setShowHistory(s => !s)}
                className="p-1.5 rounded-lg transition-colors hover:bg-surface-tertiary"
                title="執行歷史"
              >
                <History size={12} style={{ color: 'var(--color-text-tertiary)' }} />
              </button>
              <AnimatePresence>
                {showHistory && (
                  <RunHistoryPanel automationId={automation.id} onClose={() => setShowHistory(false)} />
                )}
              </AnimatePresence>
            </div>

            {/* Manual trigger */}
            <button
              onClick={handleTrigger}
              disabled={triggering || !canRunAutomation}
              className="p-1.5 rounded-lg transition-colors hover:bg-accent-light"
              title="手動執行"
            >
              {triggering
                ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                : <Play size={12} style={{ color: 'var(--color-accent)' }} />
              }
            </button>

            {lastTriggeredJobId && onOpenJob ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenJob(lastTriggeredJobId);
                }}
                className="rounded-lg border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-secondary"
              >
                Trace
              </button>
            ) : null}

            {/* Delete */}
            <button
              onClick={() => onDelete(automation.id)}
              disabled={!canRunAutomation}
              className="p-1.5 rounded-lg transition-colors hover:bg-error-light"
              title="刪除"
            >
              <Trash2 size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  workspaceMembershipSummary?: WorkspaceMembershipSummary | null;
  onOpenJob?: (jobId: string) => void;
}

export default function AutomationPanel({ workspaceId, workspaceMembershipSummary, onOpenJob }: Props) {
  const appContext = useOptionalAppContext();
  const membership = workspaceMembershipSummary ?? appContext?.workspaceMembershipSummary ?? null;
  const permissions = membership?.permissionSummary ?? {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: false,
    canDeleteDocuments: false,
    canRunAutomation: false,
  };
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [triggerFeedback, setTriggerFeedback] = useState<string | null>(null);
  const [lastTriggeredJobId, setLastTriggeredJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const list = await listAutomations(workspaceId);
      setAutomations(list);
    } catch {
      setAutomations([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!permissions.canRunAutomation) return;
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, enabled } : a));
    try {
      await toggleAutomation(id, enabled);
    } catch {
      // Revert on failure
      setAutomations(prev => prev.map(a => a.id === id ? { ...a, enabled: !enabled } : a));
    }
  };

  const handleDelete = async (id: string) => {
    if (!permissions.canRunAutomation) return;
    if (!confirm('確定要刪除這個自動化嗎？此操作無法復原。')) return;
    setAutomations(prev => prev.filter(a => a.id !== id));
    try {
      await deleteAutomation(id);
    } catch {
      load(); // Reload on failure
    }
  };

  const handleTrigger = async (id: string) => {
    if (!permissions.canRunAutomation) return;
    try {
      const response = await triggerAutomation(id);
      setLastTriggeredJobId(response.jobId);
      setTriggerFeedback(id);
      setTimeout(() => setTriggerFeedback(null), 2000);
    } catch (e: any) {
      alert(e.message || '執行失敗');
    }
  };

  const handleCreated = (automation: Automation) => {
    setAutomations(prev => [automation, ...prev]);
    setShowCreate(false);
  };

  const enabled = automations.filter(a => a.enabled);
  const disabled = automations.filter(a => !a.enabled);

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-surface)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <Zap size={15} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>自動化</span>
          {automations.length > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5"
              style={{ fontSize: 10, background: 'var(--color-accent-light)', color: 'var(--color-accent)', fontWeight: 600 }}
            >
              {enabled.length} 啟用
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!permissions.canRunAutomation}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--color-accent)', color: '#fff' }}
        >
          <Plus size={12} /> 新增
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {!permissions.canRunAutomation ? (
          <div className="mb-4">
            <ForbiddenState
              title="Read-only automation access"
              description="You can review automation history, but only editors and admins can create, trigger, or modify automations."
            />
          </div>
        ) : null}
        <AnimatePresence>
          {showCreate && (
            <CreateForm
              workspaceId={workspaceId}
              onCreated={handleCreated}
              onCancel={() => setShowCreate(false)}
            />
          )}
        </AnimatePresence>

        {/* Trigger feedback */}
        <AnimatePresence>
          {triggerFeedback && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3"
              style={{ background: 'var(--color-success-light, #e4f5ed)', border: '1px solid var(--color-success, #0a7a4c)', color: 'var(--color-success, #0a7a4c)', fontSize: 12 }}
            >
              <CheckCircle2 size={13} />
              自動化已在背景執行中
            </motion.div>
          )}
        </AnimatePresence>

        {loading && <LoadingSkeleton lines={4} />}

        {!loading && automations.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
              style={{ background: 'var(--color-accent-light)' }}
            >
              <Zap size={22} style={{ color: 'var(--color-accent)' }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              尚無自動化
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 16, maxWidth: 220 }}>
              設定觸發條件與動作，讓工作流程自動完成重複的任務
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ background: 'var(--color-accent)', color: '#fff' }}
            >
              <Plus size={14} /> 建立第一個自動化
            </button>
          </div>
        )}

        {!loading && enabled.length > 0 && (
          <div className="space-y-2 mb-4">
            {enabled.map(a => (
              <AutomationCard
                key={a.id}
                automation={a}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onTrigger={handleTrigger}
                canRunAutomation={permissions.canRunAutomation}
                lastTriggeredJobId={lastTriggeredJobId}
                onOpenJob={onOpenJob}
              />
            ))}
          </div>
        )}

        {!loading && disabled.length > 0 && (
          <div>
            <p style={{ fontSize: 10.5, color: 'var(--color-text-quaternary)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
              已停用
            </p>
            <div className="space-y-2">
              {disabled.map(a => (
                <AutomationCard
                  key={a.id}
                    automation={a}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onTrigger={handleTrigger}
                    canRunAutomation={permissions.canRunAutomation}
                    lastTriggeredJobId={lastTriggeredJobId}
                    onOpenJob={onOpenJob}
                  />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
