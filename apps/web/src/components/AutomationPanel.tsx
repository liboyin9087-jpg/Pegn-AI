import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Plus, Play, Pause, Trash2, ChevronRight, Clock, CheckCircle, XCircle, Edit2, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Automation {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: Array<{ field: string; op: string; value: string }>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  run_count: number;
  last_run_at?: string;
  last_error?: string;
  total_runs?: string;
  failed_runs?: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  'document.created': '文件建立時',
  'document.updated': '文件更新時',
  'document.deleted': '文件刪除時',
  'property.changed': '欄位值改變時',
  'agent.completed': 'Agent 完成時',
  'schedule.cron':   '定時排程',
};

const ACTION_LABELS: Record<string, string> = {
  run_agent:       '執行 AI Agent',
  send_webhook:    '發送 Webhook',
  create_document: '建立新文件',
  update_property: '更新欄位值',
  notify_user:     '通知用戶',
};

interface AutomationEditorProps {
  initial?: Partial<Automation>;
  onSave: (data: Partial<Automation>) => Promise<void>;
  onClose: () => void;
}

function AutomationEditor({ initial, onSave, onClose }: AutomationEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [triggerType, setTriggerType] = useState(initial?.trigger_type ?? 'document.created');
  const [conditions, setConditions] = useState(initial?.conditions ?? []);
  const [actions, setActions] = useState<Automation['actions']>(initial?.actions ?? [{ type: 'run_agent', config: { template: 'summarize' } }]);
  const [saving, setSaving] = useState(false);

  function addCondition() {
    setConditions(cs => [...cs, { field: 'title', op: 'contains', value: '' }]);
  }
  function removeCondition(i: number) {
    setConditions(cs => cs.filter((_, j) => j !== i));
  }
  function updateCondition(i: number, key: string, val: string) {
    setConditions(cs => cs.map((c, j) => j === i ? { ...c, [key]: val } : c));
  }

  function addAction() {
    setActions(as => [...as, { type: 'notify_user', config: { message: '' } }]);
  }
  function removeAction(i: number) {
    setActions(as => as.filter((_, j) => j !== i));
  }
  function updateActionType(i: number, type: string) {
    setActions(as => as.map((a, j) => j === i ? { ...a, type } : a));
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name, trigger_type: triggerType, conditions, actions });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    border: '1px solid var(--color-border)', borderRadius: 6,
    padding: '5px 10px', fontSize: 13, color: 'var(--color-text-primary)',
    background: 'var(--color-surface)', outline: 'none', width: '100%',
  };
  const selectStyle = { ...inputStyle };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{
          position: 'relative', background: 'var(--color-surface)', borderRadius: 12,
          border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-2xl)',
          width: 'min(520px, calc(100vw - 32px))', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Zap size={16} style={{ color: '#7c3aed' }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {initial?.id ? '編輯自動化' : '新增自動化'}
          </span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 5 }}>名稱</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例：會議記錄自動摘要" style={inputStyle} />
          </div>

          {/* Trigger */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 5 }}>
              <span style={{ marginRight: 6 }}>⚡</span>觸發條件
            </label>
            <select value={triggerType} onChange={e => setTriggerType(e.target.value)} style={selectStyle}>
              {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* Conditions */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>過濾條件（可選）</label>
              <button onClick={addCondition} style={{ fontSize: 12, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>+ 新增</button>
            </div>
            {conditions.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>無過濾條件 — 每次觸發都執行</p>
            )}
            {conditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <select value={c.field} onChange={e => updateCondition(i, 'field', e.target.value)} style={{ ...selectStyle, width: 'auto', flex: 1 }}>
                  {[['title', '標題'], ['content', '內容'], ['created_by', '建立者']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={c.op} onChange={e => updateCondition(i, 'op', e.target.value)} style={{ ...selectStyle, width: 'auto', flex: 1 }}>
                  {[['contains', '包含'], ['not_contains', '不包含'], ['eq', '等於'], ['ne', '不等於'], ['starts_with', '開頭為']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input value={c.value} onChange={e => updateCondition(i, 'value', e.target.value)} placeholder="值" style={{ ...inputStyle, flex: 2 }} />
                <button onClick={() => removeCondition(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                <span style={{ marginRight: 6 }}>▶</span>執行動作
              </label>
              <button onClick={addAction} style={{ fontSize: 12, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>+ 新增</button>
            </div>
            {actions.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 16, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                <select value={a.type} onChange={e => updateActionType(i, e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                  {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button onClick={() => removeAction(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            取消
          </button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 500, opacity: (!name.trim() || saving) ? 0.6 : 1 }}>
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

interface Props {
  workspaceId?: string;
  token?: string;
}

export function AutomationPanel({ workspaceId, token }: Props) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<Partial<Automation> | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-workspace-id': workspaceId ?? '' };

  useEffect(() => {
    if (!token || !workspaceId) return;
    setLoading(true);
    fetch(`${API_URL}/api/v1/automations`, { headers })
      .then(r => r.json())
      .then(d => setAutomations(d.automations ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, workspaceId]);

  async function toggleAutomation(id: string) {
    const resp = await fetch(`${API_URL}/api/v1/automations/${id}/toggle`, { method: 'POST', headers });
    const data = await resp.json();
    setAutomations(as => as.map(a => a.id === id ? { ...a, enabled: data.automation.enabled } : a));
  }

  async function deleteAutomation(id: string) {
    if (!confirm('確認刪除此自動化規則？')) return;
    await fetch(`${API_URL}/api/v1/automations/${id}`, { method: 'DELETE', headers });
    setAutomations(as => as.filter(a => a.id !== id));
  }

  async function saveAutomation(data: Partial<Automation>) {
    if (editTarget?.id) {
      // Update
      const resp = await fetch(`${API_URL}/api/v1/automations/${editTarget.id}`, {
        method: 'PUT', headers, body: JSON.stringify(data),
      });
      const json = await resp.json();
      setAutomations(as => as.map(a => a.id === editTarget.id ? json.automation : a));
    } else {
      // Create
      const resp = await fetch(`${API_URL}/api/v1/automations`, {
        method: 'POST', headers, body: JSON.stringify(data),
      });
      const json = await resp.json();
      setAutomations(as => [json.automation, ...as]);
    }
  }

  function relTime(iso?: string) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return '剛才';
    if (h < 24) return `${h} 小時前`;
    return `${Math.floor(h / 24)} 天前`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <Zap size={15} style={{ color: '#7c3aed' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>AI 自動化</span>
        <button onClick={() => { setEditTarget({}); setShowEditor(true); }}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <Plus size={12} /> 新增規則
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13, padding: 24 }}>載入中...</p>
        )}
        {!loading && automations.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Zap size={32} style={{ color: 'var(--color-text-quaternary)', margin: '0 auto 12px' }} />
            <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: '0 0 8px' }}>尚無自動化規則</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-quaternary)', margin: 0 }}>設定後，文件事件可自動觸發 AI Agent、Webhook 等動作</p>
          </div>
        )}
        {automations.map(auto => (
          <div key={auto.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: auto.enabled ? '#0a7a4c' : '#bbbbb4', marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{auto.name}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {TRIGGER_LABELS[auto.trigger_type] ?? auto.trigger_type}
                  {auto.conditions?.length > 0 && ` · ${auto.conditions.length} 個過濾條件`}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-quaternary)' }}>
                  {auto.actions?.map(a => ACTION_LABELS[a.type] ?? a.type).join(' → ')}
                </p>
                {auto.last_run_at && (
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--color-text-quaternary)' }}>
                    上次執行：{relTime(auto.last_run_at)} · 共 {auto.run_count} 次
                    {auto.last_error && <span style={{ color: '#c93b37', marginLeft: 6 }}>❌ 上次失敗</span>}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button onClick={() => toggleAutomation(auto.id)} title={auto.enabled ? '停用' : '啟用'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: auto.enabled ? '#0a7a4c' : 'var(--color-text-tertiary)', display: 'flex', padding: 4, borderRadius: 4 }}>
                  {auto.enabled ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <button onClick={() => { setEditTarget(auto); setShowEditor(true); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', padding: 4, borderRadius: 4 }}>
                  <Edit2 size={13} />
                </button>
                <button onClick={() => deleteAutomation(auto.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', padding: 4, borderRadius: 4 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Editor modal */}
      <AnimatePresence>
        {showEditor && (
          <AutomationEditor
            initial={editTarget ?? {}}
            onSave={saveAutomation}
            onClose={() => { setShowEditor(false); setEditTarget(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
