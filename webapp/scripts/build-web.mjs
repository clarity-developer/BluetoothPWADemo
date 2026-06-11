import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const rootFiles = [
  'index.html',
  'app.js',
  'bluetooth-transport.js',
  'styles.css',
  'manifest.webmanifest',
  'sw.js'
];

rmSync('www', { recursive: true, force: true });
mkdirSync('www/assets', { recursive: true });

for (const file of rootFiles) {
  cpSync(file, join('www', file));
}

for (const asset of readdirSync('assets')) {
  cpSync(join('assets', asset), join('www/assets', asset));
}

console.log('Built web assets into webapp/www');
