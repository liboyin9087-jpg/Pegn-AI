import { fork } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find tsx CLI path (handle hoisting in workspaces)
let tsxPath = resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
if (!existsSync(tsxPath)) {
    tsxPath = resolve(__dirname, '../../../node_modules/tsx/dist/cli.mjs');
}

console.log(`Using tsx from: ${tsxPath}`);

// Running tsx via node to bypass some temp dir permission errors
// Node v20.6.0+ requires --import instead of --loader for ESM loaders
const args = [
    '--import', tsxPath,
    resolve(__dirname, 'run-migrations.ts')
];

const child = fork(tsxPath, args, {
    env: { ...process.env, NODE_OPTIONS: '' }
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
