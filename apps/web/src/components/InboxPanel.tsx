import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, CheckCheck } from 'lucide-react';
import type { InboxNotification } from '../api/client';

interface Props {
  open: boolean;
  loading?: boolean;
  notifications: InboxNotification[];
  unreadCount: number;
  onClose: () => void;
  onOpenNotification: (notification: InboxNotification) => void;
  onMarkRead: (notificationId: string) => void;
  onMarkAllRead: () => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InboxPanel({
  open,
  loading,
  notifications,
  unreadCount,
  onClose,
  onOpenNotification,
  onMarkRead,
  onMarkAllRead,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/25 backdrop-blur-sm flex items-start justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-xl mt-10 rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-text-tertiary" />
                <h3 className="text-sm font-semibold text-text-primary">Inbox</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">{unreadCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onMarkAllRead}
                  className="text-xs px-2.5 py-1 rounded-md border border-border text-text-secondary hover:bg-surface-secondary transition-colors flex items-center gap-1"
                  disabled={unreadCount === 0}
                >
                  <CheckCheck size={12} />
                  全部已讀
                </button>
                <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">✕</button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <div className="p-6 text-sm text-text-tertiary">載入通知中...</div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-tertiary">目前沒有通知</div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => onOpenNotification(notification)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenNotification(notification);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className="w-full text-left px-5 py-4 hover:bg-surface-secondary transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: notification.status === 'unread' ? 'var(--color-accent)' : 'transparent' }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm text-text-primary font-medium">提及你於留言串</p>
                            <span className="text-[11px] text-text-quaternary">{formatTime(notification.created_at)}</span>
                          </div>
                          <p className="mt-1 text-xs text-text-secondary line-clamp-2">
                            {notification.payload?.preview || '查看留言內容'}
                          </p>
                        </div>
                        {notification.status === 'unread' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onMarkRead(notification.id);
                            }}
                            className="text-[11px] px-2 py-1 rounded-md border border-border text-text-secondary hover:bg-surface"
                          >
                            已讀
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
