const fs = require('node:fs');
const path = require('node:path');

exports.up = (pgm) => {
  const rlsPath = path.join(__dirname, '..', 'src', 'db', 'rls.sql');
  pgm.sql(fs.readFileSync(rlsPath, 'utf8'));
};

exports.down = () => {};
