#!/usr/bin/env node
/**
 * On darwin/arm64, ensure @next/swc-darwin-arm64 has the native binary.
 * npm optional deps sometimes install the package without the .node file.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (process.platform !== 'darwin' || process.arch !== 'arm64') return;

const bin = path.join(__dirname, '..', 'node_modules', '@next', 'swc-darwin-arm64', 'next-swc.darwin-arm64.node');
if (fs.existsSync(bin)) return;

console.log('[postinstall] SWC darwin-arm64 binary missing, installing @next/swc-darwin-arm64...');
execSync('npm install @next/swc-darwin-arm64@14.2.33 --no-save', {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});
