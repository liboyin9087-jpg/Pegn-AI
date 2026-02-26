import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { observability } from './observability.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export interface KgEntity {
  id: string;
  name: string;
  entity_type: string;
  description?: string;
  workspace_id: string;
  document_id?: string;
}

export interface KgRelationship {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  weight: number;
}

// ── Entity 抽取 ──────────────────────────────────────────────
export async function extractEntities(
  text: string,
  workspaceId: string,
  documentId?: string
): Promise<KgEntity[]> {
  if (!genAI || !pool || !text.trim()) return [];

  try {
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
    const prompt = `從以下文字中抽取所有重要實體（人名、地點、組織、概念、事件等），以 JSON 陣列回覆，每個物件包含 name、entity_type、description 三個欄位。只回傳 JSON，不要任何說明。

文字：
${text.slice(0, 3000)}

回傳格式範例：
[{"name":"OpenAI","entity_type":"org","description":"AI 研究公司"},{"name":"GPT-4","entity_type":"concept","description":"大型語言模型"}]`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const extracted: Array<{ name: string; entity_type: string; description?: string }> = JSON.parse(jsonStr);

    const entities: KgEntity[] = [];
    for (const e of extracted) {
      if (!e.name || !e.entity_type) continue;

      // 先查是否已存在（同 workspace + name + type）
      const existing = await pool.query(
        `SELECT id FROM kg_entities WHERE workspace_id=$1 AND name=$2 AND entity_type=$3 LIMIT 1`,
        [workspaceId, e.name, e.entity_type]
      );

      let entityId: string;
      if (existing.rows.length > 0) {
        entityId = existing.rows[0].id;
      } else {
        const ins = await pool.query(
          `INSERT INTO kg_entities (workspace_id, document_id, name, entity_type, description)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [workspaceId, documentId ?? null, e.name, e.entity_type, e.description ?? null]
        );
        entityId = ins.rows[0].id;
      }

      entities.push({ id: entityId, workspace_id: workspaceId, document_id: documentId, ...e });
    }

    observability.info('KG entities extracted', { count: entities.length, workspaceId });
    return entities;
  } catch (error) {
    observability.error('KG entity extraction failed', { error });
    return [];
  }
}

// ── Relationship 抽取 ────────────────────────────────────────
export async function extractRelationships(
  text: string,
  entities: KgEntity[],
  workspaceId: string
): Promise<KgRelationship[]> {
  if (!genAI || !pool || entities.length < 2) return [];

  try {
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
    const entityNames = entities.map(e => e.name).join('、');
    const prompt = `根據以下文字，找出這些實體之間的關係：${entityNames}

文字：${text.slice(0, 2000)}

以 JSON 陣列回覆，每個物件包含 source、target、relation_type、weight（0-1）。只回傳 JSON。

範例：[{"source":"OpenAI","target":"GPT-4","relation_type":"develops","weight":0.9}]`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const extracted: Array<{ source: string; target: string; relation_type: string; weight?: number }> = JSON.parse(jsonStr);

    const nameToId = new Map(entities.map(e => [e.name, e.id]));
    const relationships: KgRelationship[] = [];

    for (const r of extracted) {
      const sourceId = nameToId.get(r.source);
      const targetId = nameToId.get(r.target);
      if (!sourceId || !targetId) continue;

      const ins = await pool.query(
        `INSERT INTO kg_relationships (workspace_id, source_entity_id, target_entity_id, relation_type, weight)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [workspaceId, sourceId, targetId, r.relation_type, r.weight ?? 1.0]
      );

      if (ins.rows.length > 0) {
        relationships.push({
          id: ins.rows[0].id,
          source_entity_id: sourceId,
          target_entity_id: targetId,
          relation_type: r.relation_type,
          weight: r.weight ?? 1.0
        });
      }
    }

    observability.info('KG relationships extracted', { count: relationships.length, workspaceId });
    return relationships;
  } catch (error) {
    observability.error('KG relationship extraction failed', { error });
    return [];
  }
}

// ── 查詢 KG 鄰居（圖遍歷）───────────────────────────────────
export async function getEntityNeighbors(
  entityId: string,
  depth = 2
): Promise<{ entities: KgEntity[]; relationships: KgRelationship[] }> {
  if (!pool) return { entities: [], relationships: [] };

  try {
    // 遞迴 CTE 圖遍歷
    const result = await pool.query(
      `WITH RECURSIVE graph AS (
        SELECT source_entity_id, target_entity_id, relation_type, weight, 1 AS depth
        FROM kg_relationships
        WHERE source_entity_id = $1 OR target_entity_id = $1
        UNION
        SELECT r.source_entity_id, r.target_entity_id, r.relation_type, r.weight, g.depth + 1
        FROM kg_relationships r
        JOIN graph g ON (r.source_entity_id = g.target_entity_id OR r.target_entity_id = g.source_entity_id)
        WHERE g.depth < $2
      )
      SELECT DISTINCT source_entity_id, target_entity_id, relation_type, weight FROM graph`,
      [entityId, depth]
    );

    const entityIds = new Set<string>();
    const relationships: KgRelationship[] = result.rows.map((r: any) => {
      entityIds.add(r.source_entity_id);
      entityIds.add(r.target_entity_id);
      return { id: '', source_entity_id: r.source_entity_id, target_entity_id: r.target_entity_id, relation_type: r.relation_type, weight: r.weight };
    });

    const entResult = await pool.query(
      `SELECT id, name, entity_type, description, workspace_id, document_id FROM kg_entities WHERE id = ANY($1)`,
      [Array.from(entityIds)]
    );

    return { entities: entResult.rows, relationships };
  } catch (error) {
    observability.error('KG neighbor query failed', { error });
    return { entities: [], relationships: [] };
  }
}
