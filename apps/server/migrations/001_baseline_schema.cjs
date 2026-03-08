const fs = require('node:fs');
const path = require('node:path');

exports.up = (pgm) => {
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  pgm.sql(fs.readFileSync(schemaPath, 'utf8'));
};

exports.down = () => {};
