/**
 * presence.ts — lightweight real-time presence tracking.
 *
 * Tracks which users are currently viewing/editing each document.
 * State is in-memory; no DB required.
 *
 * Protocol (JSON messages over WebSocket):
 *   Client → Server:
 *     { type: "join",  documentId, userId, userName, color }
 *     { type: "leave", documentId, userId }
 *     { type: "cursor", documentId, userId, cursor: { offset } }
 *     { type: "ping" }
 *
 *   Server → Client (broadcast to everyone in the document):
 *     { type: "presence", documentId, users: PresenceUser[] }
 *     { type: "cursor",   documentId, userId, cursor }
 *     { type: "pong" }
 */

import { WebSocket } from 'ws';

export interface PresenceUser {
  userId: string;
  userName: string;
  color: string;       // assigned hex color for avatar ring
  joinedAt: number;    // epoch ms
  cursor?: { offset: number };
}

// documentId → set of connections
interface Session {
  ws: WebSocket;
  user: PresenceUser;
}

// 12 distinct colors for user presence rings
const COLORS = [
  '#2383e2', '#e24323', '#23e243', '#e2c123',
  '#9b23e2', '#23c2e2', '#e2239b', '#e26423',
  '#23e2c3', '#7b5ea7', '#e07b5e', '#5ea7e0',
];

let colorIdx = 0;
function nextColor(): string {
  return COLORS[colorIdx++ % COLORS.length];
}

class PresenceService {
  // documentId → Map<userId, Session>
  private rooms = new Map<string, Map<string, Session>>();

  /** Register a WebSocket connection joining a document. */
  join(documentId: string, user: Omit<PresenceUser, 'joinedAt' | 'color'>, ws: WebSocket): void {
    if (!this.rooms.has(documentId)) {
      this.rooms.set(documentId, new Map());
    }
    const room = this.rooms.get(documentId)!;

    const presenceUser: PresenceUser = {
      ...user,
      color: nextColor(),
      joinedAt: Date.now(),
    };

    room.set(user.userId, { ws, user: presenceUser });
    this.broadcast(documentId);
  }

  /** Remove a user from a document room. */
  leave(documentId: string, userId: string): void {
    const room = this.rooms.get(documentId);
    if (!room) return;
    room.delete(userId);
    if (room.size === 0) this.rooms.delete(documentId);
    else this.broadcast(documentId);
  }

  /** Update cursor position for a user. */
  updateCursor(documentId: string, userId: string, cursor: { offset: number }): void {
    const room = this.rooms.get(documentId);
    if (!room) return;
    const session = room.get(userId);
    if (!session) return;
    session.user.cursor = cursor;
    this.broadcastCursor(documentId, userId, cursor);
  }

  /** Remove all sessions for a disconnected WebSocket. */
  removeSocket(ws: WebSocket): void {
    for (const [documentId, room] of this.rooms) {
      for (const [userId, session] of room) {
        if (session.ws === ws) {
          room.delete(userId);
          if (room.size === 0) this.rooms.delete(documentId);
          else this.broadcast(documentId);
          break;
        }
      }
    }
  }

  /** Get current users in a document room. */
  getUsers(documentId: string): PresenceUser[] {
    const room = this.rooms.get(documentId);
    if (!room) return [];
    return [...room.values()].map(s => s.user);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private broadcast(documentId: string): void {
    const users = this.getUsers(documentId);
    const msg = JSON.stringify({ type: 'presence', documentId, users });
    const room = this.rooms.get(documentId);
    if (!room) return;
    for (const { ws } of room.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  private broadcastCursor(documentId: string, userId: string, cursor: { offset: number }): void {
    const msg = JSON.stringify({ type: 'cursor', documentId, userId, cursor });
    const room = this.rooms.get(documentId);
    if (!room) return;
    for (const [uid, { ws }] of room) {
      if (uid !== userId && ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
}

export const presenceService = new PresenceService();
