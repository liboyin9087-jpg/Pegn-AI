import { pool } from '../db/client.js';
import { observability } from './observability.js';
import { generateTextWithFallback } from './llm.js';

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

export async function extractEntities(
  text: string,
  workspaceId: string,
  documentId?: string
): Promise<KgEntity[]> {
  if (!pool || !text.trim()) return [];

  try {
    const prompt = `Extract entities from the input and return JSON only. Each entity must include name, entity_type, and optional description.\n\nInput:\n${text.slice(0, 3000)}`;
    const result = await generateTextWithFallback({
      feature: 'kg_extract_entities',
      prompt,
      fallbackText: '[]',
    });
    const raw = result.text.trim();
    const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const extracted: Array<{ name: string; entity_type: string; description?: string }> = JSON.parse(jsonStr);

    const entities: KgEntity[] = [];
    for (const entity of extracted) {
      if (!entity.name || !entity.entity_type) continue;

      const existing = await pool.query(
        `SELECT id
         FROM kg_entities
         WHERE workspace_id = $1
           AND name = $2
           AND entity_type = $3
         LIMIT 1`,
        [workspaceId, entity.name, entity.entity_type]
      );

      let entityId: string;
      if (existing.rows.length > 0) {
        entityId = existing.rows[0].id;
      } else {
        const inserted = await pool.query(
          `INSERT INTO kg_entities (workspace_id, document_id, name, entity_type, description)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [workspaceId, documentId ?? null, entity.name, entity.entity_type, entity.description ?? null]
        );
        entityId = inserted.rows[0].id;
      }

      entities.push({
        id: entityId,
        workspace_id: workspaceId,
        document_id: documentId,
        ...entity,
      });
    }

    observability.info('KG entities extracted', { count: entities.length, workspaceId });
    return entities;
  } catch (error) {
    observability.error('KG entity extraction failed', { error });
    return [];
  }
}

export async function extractRelationships(
  text: string,
  entities: KgEntity[],
  workspaceId: string
): Promise<KgRelationship[]> {
  if (!pool || entities.length < 2) return [];

  try {
    const entityNames = entities.map((entity) => entity.name).join(', ');
    const prompt = `Extract relationships between the listed entities from the input. Return JSON only with source, target, relation_type, and optional weight.\n\nEntities:\n${entityNames}\n\nInput:\n${text.slice(0, 2000)}`;
    const result = await generateTextWithFallback({
      feature: 'kg_extract_relationships',
      prompt,
      fallbackText: '[]',
    });
    const raw = result.text.trim();
    const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const extracted: Array<{ source: string; target: string; relation_type: string; weight?: number }> = JSON.parse(jsonStr);

    const nameToId = new Map(entities.map((entity) => [entity.name, entity.id]));
    const relationships: KgRelationship[] = [];

    for (const relationship of extracted) {
      const sourceId = nameToId.get(relationship.source);
      const targetId = nameToId.get(relationship.target);
      if (!sourceId || !targetId) continue;

      const inserted = await pool.query(
        `INSERT INTO kg_relationships (workspace_id, source_entity_id, target_entity_id, relation_type, weight)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [workspaceId, sourceId, targetId, relationship.relation_type, relationship.weight ?? 1]
      );

      if (inserted.rows.length === 0) continue;

      relationships.push({
        id: inserted.rows[0].id,
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relation_type: relationship.relation_type,
        weight: relationship.weight ?? 1,
      });
    }

    observability.info('KG relationships extracted', { count: relationships.length, workspaceId });
    return relationships;
  } catch (error) {
    observability.error('KG relationship extraction failed', { error });
    return [];
  }
}

export async function getEntityNeighbors(
  entityId: string,
  depth = 2
): Promise<{ entities: KgEntity[]; relationships: KgRelationship[] }> {
  if (!pool) return { entities: [], relationships: [] };

  try {
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
      SELECT DISTINCT source_entity_id, target_entity_id, relation_type, weight
      FROM graph`,
      [entityId, depth]
    );

    const entityIds = new Set<string>();
    const relationships: KgRelationship[] = result.rows.map((row: any) => {
      entityIds.add(row.source_entity_id);
      entityIds.add(row.target_entity_id);
      return {
        id: '',
        source_entity_id: row.source_entity_id,
        target_entity_id: row.target_entity_id,
        relation_type: row.relation_type,
        weight: row.weight,
      };
    });

    const entityResult = await pool.query(
      `SELECT id, name, entity_type, description, workspace_id, document_id
       FROM kg_entities
       WHERE id = ANY($1)`,
      [Array.from(entityIds)]
    );

    return { entities: entityResult.rows, relationships };
  } catch (error) {
    observability.error('KG neighbor query failed', { error });
    return { entities: [], relationships: [] };
  }
}
