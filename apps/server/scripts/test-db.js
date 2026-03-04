import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL || 'postgres://localhost:5432/postgres';
const dbName = 'ai_native';

async function setup() {
    const urls = [
        url,
        url.replace('localhost', '127.0.0.1'),
        'postgres://postgres@127.0.0.1:5432/postgres',
        'postgres://lego@127.0.0.1:5432/postgres'
    ];

    for (const testUrl of urls) {
        console.log('Testing connection to:', testUrl);
        const client = new Client({ connectionString: testUrl });
        try {
            await client.connect();
            console.log('Successfully connected!');
            await client.end();
            // If we connected to something else, we might need to create the DB
            if (!testUrl.includes(dbName)) {
                const createClient = new Client({ connectionString: testUrl });
                await createClient.connect();
                const res = await createClient.query(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
                if (res.rowCount === 0) {
                    console.log(`Database "${dbName}" not found. Creating...`);
                    await createClient.query(`CREATE DATABASE ${dbName}`);
                } else {
                    console.log(`Database "${dbName}" already exists.`);
                }
                await createClient.end();
            }
            process.exit(0);
        } catch (err) {
            console.log(`Failed for ${testUrl}: ${err.message}`);
            if (err.code) console.log(`Error code: ${err.code}`);
        }
    }
    process.exit(1);
}

setup();
