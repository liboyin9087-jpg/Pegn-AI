/**
 * websocket.ts — WebSocket server for real-time presence.
 *
 * Attach to the Express HTTP server:
 *   setupWebSocketServer(httpServer);
 *
 * Auth: pass ?token=<JWT> as a query parameter when connecting.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { presenceService } from '../services/presence.js';
import { observability } from '../services/observability.js';
import { URL } from 'url';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

interface AuthPayload {
  userId: string;
  email?: string;
  name?: string;
}

function parseToken(req: IncomingMessage): AuthPayload | null {
  try {
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, 'ws://localhost');
    const token = url.searchParams.get('token');
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return {
      userId: payload.userId || payload.sub || payload.id,
      email: payload.email,
      name: payload.name || payload.email?.split('@')[0] || 'User',
    };
  } catch {
    return null;
  }
}

export function setupWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const auth = parseToken(req);
    if (!auth) {
      ws.send(JSON.stringify({ type: 'error', message: '未授權' }));
      ws.close(1008, 'Unauthorized');
      return;
    }

    const { userId, name: userName = 'User' } = auth;
    let currentDoc: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'join': {
            const { documentId } = msg;
            if (!documentId) break;
            // Leave previous room if any
            if (currentDoc && currentDoc !== documentId) {
              presenceService.leave(currentDoc, userId);
            }
            currentDoc = documentId;
            presenceService.join(documentId, { userId, userName }, ws);
            break;
          }
          case 'leave': {
            const docId = msg.documentId || currentDoc;
            if (docId) {
              presenceService.leave(docId, userId);
              if (currentDoc === docId) currentDoc = null;
            }
            break;
          }
          case 'cursor': {
            const { documentId, cursor } = msg;
            if (documentId && cursor) {
              presenceService.updateCursor(documentId, userId, cursor);
            }
            break;
          }
          case 'ping': {
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          }
        }
      } catch (err) {
        observability.error('WS message parse error', { error: String(err), userId });
      }
    });

    ws.on('close', () => {
      if (currentDoc) presenceService.leave(currentDoc, userId);
      presenceService.removeSocket(ws);
    });

    ws.on('error', (err) => {
      observability.error('WS error', { error: String(err), userId });
    });

    // Confirm connected
    ws.send(JSON.stringify({ type: 'connected', userId }));
  });

  observability.info('WebSocket server ready on /ws');
  return wss;
}
