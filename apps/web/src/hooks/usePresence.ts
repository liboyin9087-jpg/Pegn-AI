/**
 * usePresence — connects to the WebSocket presence server and tracks
 * which users are currently viewing/editing the given document.
 *
 * Usage:
 *   const { users, connected } = usePresence({ documentId, userId, userName, token });
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface PresenceUser {
  userId: string;
  userName: string;
  color: string;
  joinedAt: number;
  cursor?: { offset: number };
}

interface Options {
  documentId: string | undefined;
  userId: string | undefined;
  userName: string | undefined;
  token: string | undefined;    // JWT token for auth
}

const WS_URL = import.meta.env.VITE_WS_URL
  ?? (import.meta.env.VITE_API_URL ?? 'http://localhost:4000')
      .replace(/^http/, 'ws');

const PING_INTERVAL_MS = 25_000;
const RECONNECT_DELAY_MS = 3_000;

export function usePresence({ documentId, userId, userName, token }: Options) {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current);
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!documentId || !userId || !token || unmountedRef.current) return;

    cleanup();

    const url = `${WS_URL}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      setConnected(true);
      ws.send(JSON.stringify({ type: 'join', documentId, userId, userName }));
      // Heartbeat to keep connection alive through proxies
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'presence' && msg.documentId === documentId) {
          // Show other users (not self)
          setUsers((msg.users as PresenceUser[]).filter(u => u.userId !== userId));
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      setConnected(false);
      setUsers([]);
      if (pingRef.current) clearInterval(pingRef.current);
      // Reconnect unless component unmounted
      if (!unmountedRef.current) {
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [documentId, userId, userName, token, cleanup]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      // Tell server we're leaving before closing
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && documentId) {
        ws.send(JSON.stringify({ type: 'leave', documentId }));
      }
      cleanup();
    };
  }, [connect, cleanup, documentId]);

  return { users, connected };
}
