const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/v1';

// ── Token 管理 ──────────────────────────────────────────────
export function getToken(): string | null {
  return localStorage.getItem('auth_token');
}
export function setToken(t: string): void {
  localStorage.setItem('auth_token', t);
}
export function clearToken(): void {
  localStorage.removeItem('auth_token');
}

// ── 基礎 fetch ───────────────────────────────────────────────
export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// ── OAuth ─────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function oauthLogin(provider: 'google' | 'github') {
  window.location.href = `${API_BASE}/api/v1/auth/${provider}`;
}

export async function getOAuthStatus(): Promise<{ google: boolean; github: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/oauth/status`);
    return res.ok ? res.json() : { google: false, github: false };
  } catch {
    return { google: false, github: false };
  }
}

// ── Auth ─────────────────────────────────────────────────────
export const register = (email: string, password: string, name: string) =>
  api<{ token: string; user: any }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
export const login = (email: string, password: string) =>
  api<{ token: string; user: any }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
export const getMe = () => api<{ user: any }>('/auth/me');

// ── Workspace ────────────────────────────────────────────────
export const listWorkspaces = () => api<{ workspaces: any[] }>('/workspaces');
export const createWorkspace = (name: string) =>
  api<any>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) });

// ── Documents ────────────────────────────────────────────────
export const listDocuments = (wsId: string) =>
  api<{ documents: any[] }>(`/workspaces/${wsId}/documents`);
export const createDocument = (wsId: string, title: string, parentId?: string) =>
  api<any>('/documents', { method: 'POST', body: JSON.stringify({ workspace_id: wsId, title, metadata: parentId ? { parent_id: parentId } : undefined }) });
export const setDocumentParent = (id: string, parentId: string | null) =>
  api<any>(`/documents/${id}/parent`, { method: 'PATCH', body: JSON.stringify({ parent_id: parentId }) });
export const deleteDocument = (id: string) =>
  api<any>(`/documents/${id}`, { method: 'DELETE' });
export const renameDocument = (id: string, title: string) =>
  api<any>(`/documents/${id}/rename`, { method: 'PATCH', body: JSON.stringify({ title }) });
export const updateDocument = (id: string, data: any) =>
  api<any>(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// ── Search ───────────────────────────────────────────────────
export const search = (query: string, wsId: string) =>
  api<{ results: any[] }>('/search', {
    method: 'POST',
    body: JSON.stringify({ query, workspace_id: wsId, limit: 10 }),
  });

// ── GraphRAG ─────────────────────────────────────────────────
export const graphragQuery = (query: string, wsId: string) =>
  api<{ answer: string; sources: any[]; entities: any[]; citations: string[] }>(
    '/graphrag/query',
    { method: 'POST', body: JSON.stringify({ query, workspace_id: wsId }) }
  );

// ── KG ───────────────────────────────────────────────────────
export const kgExtract = (text: string, wsId: string) =>
  api<{ entities: any[]; relationships: any[] }>('/kg/extract', {
    method: 'POST',
    body: JSON.stringify({ text, workspace_id: wsId }),
  });
export const kgEntities = (wsId: string) =>
  api<{ entities: any[] }>(`/kg/entities?workspace_id=${wsId}`);
export const kgRelationships = (wsId: string) =>
  api<{ relationships: any[] }>(`/kg/relationships?workspace_id=${wsId}`);
export const kgNeighbors = (entityId: string) =>
  api<{ entities: any[]; relationships: any[] }>(`/kg/entities/${entityId}/neighbors`);

// ── Agent ────────────────────────────────────────────────────
export const startResearchAgent = (query: string, wsId: string) =>
  api<{ run_id: string }>('/agents/research', {
    method: 'POST',
    body: JSON.stringify({ query, workspace_id: wsId }),
  });
export const startSummarizeAgent = (text: string, wsId: string) =>
  api<{ run_id: string }>('/agents/summarize', {
    method: 'POST',
    body: JSON.stringify({ text, workspace_id: wsId }),
  });
export const getAgentRun = (runId: string) => api<any>(`/agents/runs/${runId}`);

// ── Collections ──────────────────────────────────────────────
export const listCollections = (wsId: string) =>
  api<{ collections: any[] }>(`/collections/workspace/${wsId}`);
export const getCollection = (id: string) =>
  api<any>(`/collections/${id}`);
export const createCollection = (data: { workspaceId: string; name: string; description?: string; icon?: string; schema?: any }) =>
  api<any>('/collections', { method: 'POST', body: JSON.stringify(data) });
export const updateCollection = (id: string, data: any) =>
  api<any>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCollection = (id: string) =>
  api<any>(`/collections/${id}`, { method: 'DELETE' });
export const listCollectionDocuments = (id: string) =>
  api<{ documents: any[] }>(`/collections/${id}/documents`);

// ── Collection Views ─────────────────────────────────────────
export const listCollectionViews = (collectionId: string) =>
  api<{ views: any[] }>(`/collection_views/collection/${collectionId}`);
export const createCollectionView = (data: { collectionId: string; name: string; type: string; configuration?: any; position?: number }) =>
  api<any>('/collection_views', { method: 'POST', body: JSON.stringify(data) });
export const updateCollectionView = (id: string, data: any) =>
  api<any>(`/collection_views/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCollectionView = (id: string) =>
  api<any>(`/collection_views/${id}`, { method: 'DELETE' });

export const exportCollection = async (id: string, format: 'csv' | 'json' = 'csv') => {
  const token = getToken();
  const res = await fetch(`${BASE}/collections/${id}/export?format=${format}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
};

// ── SSE helpers ──────────────────────────────────────────────
export function sseStream(path: string, onData: (d: any) => void, onDone: () => void) {
  const token = getToken();
  const url = `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}${path}${token ? `?token=${token}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = (e) => { try { onData(JSON.parse(e.data)); } catch { } };
  es.addEventListener('done', () => { onDone(); es.close(); });
  es.onerror = () => es.close();
  return () => es.close();
}
