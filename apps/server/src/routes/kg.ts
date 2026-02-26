import type { Express, Request, Response } from 'express';
import { extractEntities, extractRelationships, getEntityNeighbors } from '../services/kg.js';
import { pool } from '../db/client.js';

export function registerKgRoutes(app: Express): void {

  // 從文字抽取實體與關係並存入 KG
  app.post('/api/v1/kg/extract', async (req: Request, res: Response) => {
    const { text, workspace_id, document_id } = req.body;
    if (!text || !workspace_id) {
      res.status(400).json({ error: 'text 和 workspace_id 為必填' });
      return;
    }
    const entities = await extractEntities(text, workspace_id, document_id);
    const relationships = await extractRelationships(text, entities, workspace_id);
    res.json({ entities, relationships });
  });

  // 列出 workspace 的所有實體
  app.get('/api/v1/kg/entities', async (req: Request, res: Response) => {
    if (!pool) { res.status(503).json({ error: 'DB unavailable' }); return; }
    const { workspace_id, type } = req.query;
    if (!workspace_id) { res.status(400).json({ error: 'workspace_id 為必填' }); return; }

    let query = `SELECT id, name, entity_type, description, document_id, created_at FROM kg_entities WHERE workspace_id = $1`;
    const params: any[] = [workspace_id];
    if (type) { query += ` AND entity_type = $2`; params.push(type); }
    query += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);
    res.json({ entities: result.rows });
  });

  // 取得單一實體的鄰居圖
  app.get('/api/v1/kg/entities/:id/neighbors', async (req: Request, res: Response) => {
    const { id } = req.params;
    const depth = Math.min(Number(req.query.depth ?? 2), 3);
    const graph = await getEntityNeighbors(id, depth);
    res.json(graph);
  });

  // 列出所有關係
  app.get('/api/v1/kg/relationships', async (req: Request, res: Response) => {
    if (!pool) { res.status(503).json({ error: 'DB unavailable' }); return; }
    const { workspace_id } = req.query;
    if (!workspace_id) { res.status(400).json({ error: 'workspace_id 為必填' }); return; }

    const result = await pool.query(
      `SELECT r.id, r.relation_type, r.weight,
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
