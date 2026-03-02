import pkg from 'pg';
const { Client } = pkg;
import http from 'http';

async function testNetwork() {
    console.log('--- Testing Port Listen ---');
    const server = http.createServer((req, res) => {
        res.end('ok');
    });

    try {
        server.listen(4000, () => {
            console.log('Successfully listening on port 4000!');
            server.close();
        });
    } catch (err) {
        console.error('Failed to listen on port 4000:', err.message);
    }

    console.log('--- Testing Unix Socket DB Connection ---');
    // For Unix sockets, host is the directory containing the socket file
    const client = new Client({
        host: '/tmp',
        database: 'postgres',
        user: 'lego'
    });

    try {
        await client.connect();
        console.log('Successfully connected via Unix Socket!');
        const res = await client.query('SELECT current_database(), current_user');
        console.log('Connected to:', res.rows[0]);
        await client.end();
    } catch (err) {
        console.error('Unix Socket connection failed:', err.message);
    }
}

testNetwork();
