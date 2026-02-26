import type { Express, Request, Response } from 'express';
import { extractEntities, extractRelationships, getEntityNeighbors } from '../services/kg.js';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromBody, getWorkspaceIdFromRequest } from '../services/request.js';

export function registerKgRoutes(app: Express): void {

  // 從文字抽取實體與關係並存入 KG
  app.post('/api/v1/kg/extract', authMiddleware, checkPermission('collection:edit'), async (req: Request, res: Response) => {
    const { text, document_id } = req.body;
    const workspace_id = getWorkspaceIdFromBody(req.body);
    if (!text || !workspace_id) {
      res.status(400).json({ error: 'text and workspace_id are required' });
      return;
    }
    const entities = await extractEntities(text, workspace_id, document_id);
    const relationships = await extractRelationships(text, entities, workspace_id);
    res.json({ entities, relationships });
  });

  // 列出 workspace 的所有實體
  app.get('/api/v1/kg/entities', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    if (!pool) { res.status(503).json({ error: 'DB unavailable' }); return; }
    const workspace_id = getWorkspaceIdFromRequest(req);
    const { type } = req.query;
    if (!workspace_id) { res.status(400).json({ error: 'workspace_id 為必填' }); return; }

    let query = `SELECT id, name, entity_type, description, document_id, created_at FROM kg_entities WHERE workspace_id = $1`;
    const params: any[] = [workspace_id];
    if (type) { query += ` AND entity_type = $2`; params.push(type); }
    query += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);
    res.json({ entities: result.rows });
  });

  // 取得單一實體的鄰居圖
  app.get('/api/v1/kg/entities/:entity_id/neighbors', authMiddleware, checkPermission('collection:view', 'kg_entity'), async (req: Request, res: Response) => {
    const { entity_id } = req.params;
    const depth = Math.min(Number(req.query.depth ?? 2), 3);
    const graph = await getEntityNeighbors(entity_id, depth);
    res.json(graph);
  });

  // 更新實體內容
  app.patch('/api/v1/kg/entities/:entity_id', authMiddleware, checkPermission('collection:edit', 'kg_entity'), async (req: Request, res: Response) => {
    if (!pool) { res.status(503).json({ error: 'DB unavailable' }); return; }
    const { entity_id } = req.params;
    const { name, entity_type, description } = req.body ?? {};

    if (!name || !entity_type) {
      res.status(400).json({ error: 'name and entity_type are required' });
      return;
    }

    const result = await pool.query(
      `UPDATE kg_entities
       SET name = $2, entity_type = $3, description = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, document_id, name, entity_type, description, updated_at`,
      [entity_id, name, entity_type, description ?? null]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    res.json({ entity: result.rows[0] });
  });

  // 刪除實體（關聯會由 FK cascade 刪除）
  app.delete('/api/v1/kg/entities/:entity_id', authMiddleware, checkPermission('collection:edit', 'kg_entity'), async (req: Request, res: Response) => {
    if (!pool) { res.status(503).json({ error: 'DB unavailable' }); return; }
    const { entity_id } = req.params;

    const result = await pool.query(
      'DELETE FROM kg_entities WHERE id = $1 RETURNING id',
      [entity_id]
    );
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }
    res.json({ success: true, id: entity_id });
  });

  // 列出所有關係
  app.get('/api/v1/kg/relationships', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    if (!pool) { res.status(503).json({ error: 'DB unavailable' }); return; }
    const workspace_id = getWorkspaceIdFromRequest(req);
    if (!workspace_id) { res.status(400).json({ error: 'workspace_id 為必填' }); return; }

    const result = await pool.query(
      `SELECT r.id, r.source_entity_id, r.target_entity_id, r.relation_type, r.weight,
              s.name as source_name, s.entity_type as source_type,
              t.name as target_name, t.entity_type as target_type
       FROM kg_relationships r
       JOIN kg_entities s ON r.source_entity_id = s.id
       JOIN kg_entities t ON r.target_entity_id = t.id
       WHERE r.workspace_id = $1
       ORDER BY r.weight DESC LIMIT 200`,
      [workspace_id]
    );
    res.json({ relationships: result.rows });
  });
}
