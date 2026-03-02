import pkg from 'pg';
const { Client } = pkg;

const dbName = 'ai_native';
const socketPath = '/tmp';

async function reset() {
    console.log('--- ⚠️ 正在強制重設資料庫 ---');

    const client = new Client({
        host: socketPath,
        database: 'postgres',
        user: 'lego'
    });

    try {
        await client.connect();

        // Terminate existing connections to the DB so we can drop it
        console.log(`正在中斷與 ${dbName} 的所有連線...`);
        await client.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid();
    `, [dbName]);

        console.log(`正在刪除資料庫 "${dbName}"...`);
        await client.query(`DROP DATABASE IF EXISTS ${dbName}`);

        console.log(`正在重新建立資料庫 "${dbName}"...`);
        await client.query(`CREATE DATABASE ${dbName}`);

        await client.end();
        console.log('✅ 資料庫已完全清空並重製！');

    } catch (err) {
        console.error('❌ 重設失敗：', err.message);
        process.exit(1);
    }
}

reset();
