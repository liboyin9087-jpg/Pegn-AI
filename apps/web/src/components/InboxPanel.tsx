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

function getNotificationMeta(notification: InboxNotification): { title: string; body: string } {
  switch (notification.type) {
    case 'mention':
      return {
        title: 'Mention',
        body: notification.summary || notification.payload.preview || 'You were mentioned in a comment thread.',
      };
    case 'quota_alert':
      return {
        title: notification.payload.title || 'Quota alert',
        body: notification.summary || notification.payload.message,
      };
    case 'automation':
      return {
        title: notification.payload.title || 'Automation update',
        body: notification.summary || notification.payload.message,
      };
    case 'unknown':
      return {
        title: notification.payload.title || 'System notification',
        body: notification.summary || notification.payload.message || 'Open this notification to inspect the related surface.',
      };
  }
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
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="mt-10 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-text-tertiary" />
                <h3 className="text-sm font-semibold text-text-primary">Inbox</h3>
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">{unreadCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onMarkAllRead}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-secondary"
                  disabled={unreadCount === 0}
                >
                  <CheckCheck size={12} />
                  Mark all read
                </button>
                <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <div className="p-6 text-sm text-text-tertiary">Loading notifications...</div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-tertiary">No notifications yet.</div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((notification) => {
                    const meta = getNotificationMeta(notification);
                    return (
                      <div
                        key={notification.id}
                        onClick={() => onOpenNotification(notification)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onOpenNotification(notification);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className="w-full cursor-pointer px-5 py-4 text-left transition-colors hover:bg-surface-secondary"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ background: notification.status === 'unread' ? 'var(--color-accent)' : 'transparent' }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-text-primary">{meta.title}</p>
                              <span className="text-[11px] text-text-quaternary">{formatTime(notification.created_at)}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{meta.body}</p>
                          </div>
                          {notification.status === 'unread' ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                onMarkRead(notification.id);
                              }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
                            >
                              Mark read
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
