import pkg from 'pg';
const { Client } = pkg;

const dbName = 'ai_native';
const socketPath = '/tmp'; // macOS default for many PG installs

async function run() {
    console.log('--- 🚀 AI Native Database Setup ---');

    // 1. Try to connect to 'postgres' default database via Unix Socket
    const client = new Client({
        host: socketPath,
        database: 'postgres',
        user: 'lego'
    });

    try {
        await client.connect();
        console.log('✅ 已透過 Unix Socket 成功連線到 PostgreSQL');

        // 2. Check if ai_native exists
        const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        if (res.rowCount === 0) {
            console.log(`正在建立資料庫 "${dbName}"...`);
            await client.query(`CREATE DATABASE ${dbName}`);
            console.log('✅ 資料庫建立成功！');
        } else {
            console.log(`✅ 資料庫 "${dbName}" 已存在`);
        }
        await client.end();

        console.log('\n接下來請在您的終端機執行：');
        console.log(`cd "/Users/lego/Desktop/pegn Ai/apps/server" && npm install && node scripts/run-migrations-safe.js`);

    } catch (err) {
        console.error('❌ 設定失敗：', err.message);
        console.log('\n請嘗試手動輸入以下指令來尋找 psql 路徑：');
        console.log('find /Applications /usr/local /opt/homebrew -name psql 2>/dev/null');
    }
}

run();
