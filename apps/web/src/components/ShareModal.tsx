import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Link, Mail, Users, Shield, Check } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function ShareModal({ isOpen, onClose, workspaceName }: ShareModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    // Placeholder for invite logic
    console.log(`Inviting ${email} as ${role}`);
    setEmail('');
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
            className="bg-panel border border-border rounded-2xl shadow-2xl w-[480px] overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-secondary">
              <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
                <Users size={18} className="text-accent" />
                分享 "{workspaceName}"
              </h3>
              <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Invite Form */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">邀請成員</label>
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
                    onChange={e => setRole(e.target.value)}
                    className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="viewer">檢視者</option>
                    <option value="editor">編輯者</option>
                    <option value="owner">擁有者</option>
                  </select>
                  <button
                    type="submit"
                    disabled={!email}
                    className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-xl text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    邀請
                  </button>
                </form>
              </div>

              {/* Member List */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">目前成員</label>
                <div className="space-y-2">
                  {[
                    { name: '你', email: 'you@example.com', role: 'owner', isMe: true },
                    { name: 'AI 助理', email: 'ai@pegn.ai', role: 'editor', isMe: false },
                  ].map((member, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-secondary transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-sm font-medium">
                          {member.name.charAt(0)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-text-primary flex items-center gap-2">
                            {member.name}
                            {member.isMe && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-tertiary">你</span>}
                          </div>
                          <div className="text-xs text-text-tertiary">{member.email}</div>
                        </div>
                      </div>
                      <div className="text-sm text-text-secondary flex items-center gap-1">
                        {member.role === 'owner' && <Shield size={14} className="text-accent" />}
                        {member.role === 'owner' ? '擁有者' : member.role === 'editor' ? '編輯者' : '檢視者'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Link Sharing */}
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
