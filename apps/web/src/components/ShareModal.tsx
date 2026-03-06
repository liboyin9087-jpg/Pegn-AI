import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Mail, Users, Shield, UserPlus, Trash2 } from 'lucide-react';
import {
  createWorkspaceInvite,
  listWorkspaceInvites,
  listWorkspaceMembers,
  revokeWorkspaceInvite,
  type WorkspaceInviteRecord,
  type WorkspaceMemberRecord,
  type WorkspaceMembershipSummary,
} from '../api/client';
import { useOptionalAppContext } from '../contexts/AppContext';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import ForbiddenState from './ForbiddenState';
import LoadingSkeleton from './LoadingSkeleton';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId?: string;
  workspaceName: string;
  workspaceMembershipSummary?: WorkspaceMembershipSummary | null;
}

interface InviteLinkState {
  email: string;
  role: string;
  invite_link: string;
  expires_at: string;
}

function roleLabel(role: string) {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    case 'editor':
      return 'Editor';
    default:
      return 'Viewer';
  }
}

export default function ShareModal({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
  workspaceMembershipSummary,
}: ShareModalProps) {
  const appContext = useOptionalAppContext();
  const membership = workspaceMembershipSummary ?? appContext?.workspaceMembershipSummary ?? null;
  const canManageMembers = membership?.permissionSummary.canManageMembers ?? false;

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<WorkspaceMemberRecord[]>([]);
  const [invites, setInvites] = useState<WorkspaceInviteRecord[]>([]);
  const [inviteLink, setInviteLink] = useState<InviteLinkState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === 'pending'),
    [invites]
  );

  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const memberRes = await listWorkspaceMembers(workspaceId);
      setMembers(memberRes.members || []);
      if (canManageMembers) {
        const inviteRes = await listWorkspaceInvites(workspaceId);
        setInvites(inviteRes.invites || []);
      } else {
        setInvites([]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load workspace sharing data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setInviteLink(null);
    void refresh();
  }, [canManageMembers, isOpen, workspaceId]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !email.trim() || !canManageMembers) return;

    setLoading(true);
    setError(null);
    try {
      const res = await createWorkspaceInvite(workspaceId, email.trim(), role);
      setInviteLink({
        email: res.invite.email,
        role: res.invite.role,
        invite_link: res.invite.invite_link ?? '',
        expires_at: res.invite.expires_at,
      });
      setEmail('');
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to create invite.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink?.invite_link) return;
    await navigator.clipboard.writeText(inviteLink.invite_link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (inviteId: string) => {
    if (!workspaceId || !canManageMembers) return;
    try {
      await revokeWorkspaceInvite(workspaceId, inviteId);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to revoke invite.');
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
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
            onClick={(event) => event.stopPropagation()}
            className="w-[560px] max-w-[94vw] overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border bg-surface-secondary px-5 py-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-text-primary">
                <Users size={18} className="text-accent" />
                Share "{workspaceName}"
              </h3>
              <button onClick={onClose} className="text-text-tertiary transition-colors hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-5">
              {error ? <ErrorState title="Failed to load sharing settings" description={error} /> : null}

              {!canManageMembers ? (
                <ForbiddenState
                  title="Read-only sharing"
                  description="You can view workspace members, but only managers can change invites or sharing settings."
                />
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-medium text-text-primary">Invite teammate</label>
                {canManageMembers ? (
                  <form onSubmit={handleInvite} className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="teammate@example.com"
                        className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value as 'admin' | 'editor' | 'viewer')}
                      className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="submit"
                      disabled={!workspaceId || !email.trim() || loading}
                      className="flex items-center gap-1 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      <UserPlus size={14} />
                      Invite
                    </button>
                  </form>
                ) : (
                  <p className="text-xs text-text-tertiary">Only managers can send invites from this workspace.</p>
                )}
              </div>

              {inviteLink ? (
                <div className="space-y-2 rounded-xl border border-border bg-surface-secondary p-3">
                  <p className="text-sm font-medium text-text-primary">Invite link ready</p>
                  <p className="text-xs text-text-tertiary">
                    {inviteLink.email} as {roleLabel(inviteLink.role)} · expires {new Date(inviteLink.expires_at).toLocaleString()}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      value={inviteLink.invite_link}
                      readOnly
                      className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary"
                    />
                    <button
                      onClick={() => void handleCopyInviteLink()}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-hover"
                    >
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                </div>
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-medium text-text-primary">Members</label>
                {loading ? (
                  <LoadingSkeleton lines={3} />
                ) : members.length === 0 ? (
                  <EmptyState title="No members yet" description="Invite teammates to start collaborating in this workspace." />
                ) : (
                  <div className="max-h-[180px] space-y-2 overflow-y-auto pr-1">
                    {members.map((member) => (
                      <div key={member.id} className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-surface-secondary">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-sm font-medium text-accent">
                            {(member.name || member.email || '?').charAt(0)}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-text-primary">{member.name || 'Unnamed user'}</div>
                            <div className="text-xs text-text-tertiary">{member.email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-text-secondary">
                          {(member.role === 'owner' || member.role === 'admin') ? <Shield size={14} className="text-accent" /> : null}
                          {roleLabel(member.role)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-text-primary">Pending invites</label>
                {!canManageMembers ? (
                  <p className="py-2 text-xs text-text-tertiary">Only managers can review or revoke pending invites.</p>
                ) : loading ? (
                  <LoadingSkeleton lines={2} />
                ) : pendingInvites.length === 0 ? (
                  <EmptyState title="No pending invites" description="New invites will appear here until they are accepted or revoked." />
                ) : (
                  <div className="max-h-[140px] space-y-2 overflow-y-auto pr-1">
                    {pendingInvites.map((invite) => (
                      <div key={invite.id} className="flex items-center justify-between rounded-lg border border-border bg-surface p-2">
                        <div>
                          <div className="text-sm text-text-primary">{invite.email}</div>
                          <div className="text-xs text-text-tertiary">
                            {roleLabel(invite.role)} · expires {new Date(invite.expires_at).toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={() => void handleRevoke(invite.id)}
                          className="flex items-center gap-1 rounded bg-error/10 px-2 py-1 text-xs text-error transition-colors hover:bg-error/15"
                        >
                          <Trash2 size={12} />
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
