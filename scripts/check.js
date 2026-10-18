'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const files = [];
function walk(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isDirectory()) walk(file);
    else if (file.endsWith('.js')) files.push(file);
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'public', 'js'));
files.push(path.join(root, 'server.js'));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}
console.log(`Parsed ${files.length} JavaScript files.`);
