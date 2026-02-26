import 'dotenv/config';
import { runMigrations } from '../src/db/migrations.js';

async function execute() {
    console.log('Running DB Migrations...');
    // Environment variables are loaded via 'import dotenv/config'
    try {
        await runMigrations();
        console.log('Migrations complete.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

execute();
