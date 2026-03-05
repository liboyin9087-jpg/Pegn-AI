import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { History, X, RotateCcw, ChevronRight } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Version {
  id: string;
  version_number: number;
  title: string;
  created_at: string;
  author_name?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  documentId?: string;
  token?: string;
  workspaceId?: string;
  onRestored?: () => void;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛才';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const d = Math.floor(hrs / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
}

export function VersionHistory({ open, onClose, documentId, token, workspaceId, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-workspace-id': workspaceId ?? '',
  };

  useEffect(() => {
    if (!open || !documentId || !token) return;
    setLoading(true);
    fetch(`${API_URL}/api/v1/doc-versions/${documentId}`, { headers })
      .then(r => r.json())
      .then(d => setVersions(d.versions ?? []))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [open, documentId, token]);

  async function createSnapshot() {
    if (!documentId) return;
    await fetch(`${API_URL}/api/v1/doc-versions/${documentId}`, { method: 'POST', headers });
    // Refresh list
    const r = await fetch(`${API_URL}/api/v1/doc-versions/${documentId}`, { headers });
    const d = await r.json();
    setVersions(d.versions ?? []);
  }

  async function restore(ver: number) {
    if (!documentId || !confirm(`確認還原至版本 #${ver}？目前內容會被儲存為新版本。`)) return;
    setRestoring(ver);
    try {
      await fetch(`${API_URL}/api/v1/doc-versions/${documentId}/${ver}/restore`, { method: 'POST', headers });
      onRestored?.();
      onClose();
    } finally {
      setRestoring(null);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.3)' }}
          />
          <motion.div
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 320,
              background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)',
              zIndex: 901, display: 'flex', flexDirection: 'column',
              boxShadow: 'var(--shadow-xl)',
            }}>

            {/* Header */}
            <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={15} style={{ color: 'var(--color-text-secondary)' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>版本歷史</span>
              <button onClick={createSnapshot}
                style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-accent)', background: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 5, border: '1px solid var(--color-border)' }}>
                儲存快照
              </button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', marginLeft: 4 }}>
                <X size={15} />
              </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {loading && (
                <p style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13, padding: 24 }}>載入中...</p>
              )}
              {!loading && versions.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <History size={28} style={{ color: 'var(--color-text-quaternary)', margin: '0 auto 12px' }} />
                  <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: '0 0 8px' }}>尚無版本記錄</p>
                  <p style={{ fontSize: 12, color: 'var(--color-text-quaternary)', margin: 0 }}>點擊「儲存快照」建立第一個版本</p>
                </div>
              )}
              {versions.map((v, i) => (
                <div key={v.id} style={{ padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: 10, borderBottom: '1px solid var(--color-border)' }}>
                  {/* Timeline dot */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 2 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? 'var(--color-accent)' : 'var(--color-border-strong)', flexShrink: 0 }} />
                    {i < versions.length - 1 && <div style={{ width: 1, height: 32, background: 'var(--color-border)', marginTop: 2 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: i === 0 ? 500 : 400, color: 'var(--color-text-primary)' }}>
                      {v.title || 'Untitled'} {i === 0 && <span style={{ fontSize: 10, background: 'var(--color-accent-light)', color: 'var(--color-accent)', borderRadius: 3, padding: '1px 5px', marginLeft: 4 }}>最新</span>}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      版本 #{v.version_number} · {relativeTime(v.created_at)}
                      {v.author_name && ` · ${v.author_name}`}
                    </p>
                  </div>
                  {i > 0 && (
                    <button
                      onClick={() => restore(v.version_number)}
                      disabled={restoring === v.version_number}
                      title="還原至此版本"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <RotateCcw size={12} style={{ opacity: restoring === v.version_number ? 0.5 : 1 }} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-quaternary)' }}>
              版本記錄保留最近 50 個快照
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
