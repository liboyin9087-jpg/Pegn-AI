import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Link, Mail, Users, Shield, Check, UserPlus, Trash2 } from 'lucide-react';
import {
  createWorkspaceInvite,
  listWorkspaceInvites,
  listWorkspaceMembers,
  revokeWorkspaceInvite,
} from '../api/client';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId?: string;
  workspaceName: string;
}

interface InviteLinkState {
  email: string;
  role: string;
  invite_link: string;
  expires_at: string;
}

export default function ShareModal({ isOpen, onClose, workspaceId, workspaceName }: ShareModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [inviteLink, setInviteLink] = useState<InviteLinkState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canManageInvites, setCanManageInvites] = useState(true);

  const pendingInvites = useMemo(
    () => invites.filter(i => i.status === 'pending'),
    [invites]
  );

  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const memberRes = await listWorkspaceMembers(workspaceId);
      setMembers(memberRes.members || []);
      try {
        const inviteRes = await listWorkspaceInvites(workspaceId);
        setInvites(inviteRes.invites || []);
        setCanManageInvites(true);
      } catch {
        setInvites([]);
        setCanManageInvites(false);
      }
    } catch {
      setError('無法載入成員資料');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setInviteLink(null);
      void refresh();
    }
  }, [isOpen, workspaceId]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !email.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await createWorkspaceInvite(workspaceId, email.trim(), role);
      setInviteLink({
        email: res.invite.email,
        role: res.invite.role,
        invite_link: res.invite.invite_link,
        expires_at: res.invite.expires_at,
      });
      setEmail('');
      await refresh();
    } catch (err: any) {
      setError(err?.message || '邀請失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink?.invite_link) return;
    await navigator.clipboard.writeText(inviteLink.invite_link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (inviteId: string) => {
    if (!workspaceId) return;
    try {
      await revokeWorkspaceInvite(workspaceId, inviteId);
      await refresh();
    } catch {
      setError('撤銷邀請失敗');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            onClick={e => e.stopPropagation()}
            className="bg-panel border border-border rounded-2xl shadow-2xl w-[560px] max-w-[94vw] overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-secondary">
              <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
                <Users size={18} className="text-accent" />
                分享 "{workspaceName}"
              </h3>
              <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {error && (
                <div className="text-sm text-error bg-error-light rounded-lg px-3 py-2 border border-error/20">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">邀請成員</label>
                {canManageInvites ? (
                  <form onSubmit={handleInvite} className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="輸入 Email 地址..."
                        className="w-full bg-surface border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <select
                      value={role}
                      onChange={e => setRole(e.target.value as any)}
                      className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="viewer">檢視者</option>
                      <option value="editor">編輯者</option>
                      <option value="admin">管理員</option>
                    </select>
                    <button
                      type="submit"
                      disabled={!workspaceId || !email || loading}
                      className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-xl text-white text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-1"
                    >
                      <UserPlus size={14} /> 邀請
                    </button>
                  </form>
                ) : (
                  <p className="text-xs text-text-tertiary">你沒有邀請權限（需要管理員）。</p>
                )}
              </div>

              {inviteLink && (
                <div className="rounded-xl border border-border bg-surface-secondary p-3 space-y-2">
                  <p className="text-sm font-medium text-text-primary">邀請已建立</p>
                  <p className="text-xs text-text-tertiary">
                    {inviteLink.email} · {inviteLink.role} · 到期 {new Date(inviteLink.expires_at).toLocaleString('zh-TW')}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      value={inviteLink.invite_link}
                      readOnly
                      className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-text-secondary"
                    />
                    <button
                      onClick={handleCopyInviteLink}
                      className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs hover:bg-accent-hover transition-colors"
                    >
                      複製邀請連結
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">目前成員</label>
                <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                  {members.map((member, i) => (
                    <div key={member.id || i} className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-secondary transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-sm font-medium">
                          {(member.name || member.email || '?').charAt(0)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-text-primary">{member.name || '未命名'}</div>
                          <div className="text-xs text-text-tertiary">{member.email}</div>
                        </div>
                      </div>
                      <div className="text-sm text-text-secondary flex items-center gap-1">
                        {(member.role === 'owner' || member.role === 'admin') && <Shield size={14} className="text-accent" />}
                        {member.role === 'owner' ? '擁有者' : member.role === 'admin' ? '管理員' : member.role === 'editor' ? '編輯者' : '檢視者'}
                      </div>
                    </div>
                  ))}
                  {!loading && members.length === 0 && (
                    <p className="text-xs text-text-tertiary py-2">目前尚無成員</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">待接受邀請</label>
                {canManageInvites ? (
                  <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                    {pendingInvites.map((invite, i) => (
                      <div key={invite.id || i} className="flex items-center justify-between p-2 rounded-lg border border-border bg-surface">
                        <div>
                          <div className="text-sm text-text-primary">{invite.email}</div>
                          <div className="text-xs text-text-tertiary">{invite.role} · 到期 {new Date(invite.expires_at).toLocaleString('zh-TW')}</div>
                        </div>
                        <button
                          onClick={() => handleRevoke(invite.id)}
                          className="text-xs px-2 py-1 rounded bg-error-light text-error hover:bg-error/10 transition-colors flex items-center gap-1"
                        >
                          <Trash2 size={12} /> 撤銷
                        </button>
                      </div>
                    ))}
                    {!loading && pendingInvites.length === 0 && (
                      <p className="text-xs text-text-tertiary py-2">目前沒有待接受邀請</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-text-tertiary py-2">只有管理員可檢視邀請紀錄。</p>
                )}
              </div>

              <div className="pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-text-primary">公開連結分享</div>
                    <div className="text-xs text-text-tertiary mt-0.5">任何擁有連結的人都可以檢視此工作區</div>
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary border border-border rounded-lg text-sm text-text-secondary transition-colors"
                  >
                    {copied ? <Check size={14} className="text-green-500" /> : <Link size={14} />}
                    {copied ? '已複製' : '複製連結'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
