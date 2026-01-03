#!/usr/bin/env node
/**
 * Generate placeholder icons for the Brain Web extension.
 * Creates simple colored icons with a "BW" text overlay.
 */

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createIcon(size, outputPath) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#4A90E2');
  gradient.addColorStop(1, '#2C5F8D');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  
  // Rounded rectangle overlay
  const margin = size / 8;
  const radius = size / 6;
  ctx.fillStyle = '#2C5F8D';
  ctx.strokeStyle = '#1A3A5C';
  ctx.lineWidth = Math.max(1, size / 32);
  
  ctx.beginPath();
  ctx.roundRect(margin, margin, size - 2 * margin, size - 2 * margin, radius);
  ctx.fill();
  ctx.stroke();
  
  // Add "BW" text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${Math.floor(size / 2)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BW', size / 2, size / 2);
  
  // Save as PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`Created ${outputPath} (${size}x${size})`);
}

function main() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const outputPath = path.join(assetsDir, `icon${size}.png`);
    createIcon(size, outputPath);
  }
  
  console.log(`\nIcons created in ${assetsDir}`);
}

main();

