import pkg from 'pg';
const { Pool } = pkg;
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
    host: '/tmp',
    database: 'ai_native',
    user: 'lego'
});

async function migrate() {
    console.log('--- Migrating via Unix Socket ---');
    try {
        const schemaSql = readFileSync(join(__dirname, '../src/db/schema.sql'), 'utf-8');
        await pool.query(schemaSql);
        console.log('Schema applied successfully!');

        // Seed roles
        console.log('Seeding default roles...');
        const defaultRoles = [
            ['admin', 'Full access', JSON.stringify(['workspace:admin', 'collection:create', 'collection:edit', 'collection:delete', 'collection:view', 'document:create', 'document:edit', 'document:delete', 'document:view'])],
            ['editor', 'Can create and edit', JSON.stringify(['collection:create', 'collection:edit', 'collection:view', 'document:create', 'document:edit', 'document:view'])],
            ['viewer', 'Read-only', JSON.stringify(['collection:view', 'document:view'])]
        ];

        for (const [name, desc, perms] of defaultRoles) {
            await pool.query(
                'INSERT INTO roles (name, description, permissions) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, name) WHERE workspace_id IS NULL DO UPDATE SET permissions = EXCLUDED.permissions',
                [name, desc, perms]
            );
        }
        console.log('Roles seeded!');
        await pool.end();
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
