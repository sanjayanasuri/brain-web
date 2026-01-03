#!/usr/bin/env node
/**
 * Generate simple placeholder icons using minimal PNG data.
 * Creates solid color icons with "BW" text (simulated with colored squares).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal valid PNG for a solid color (blue)
// This is a 1x1 blue pixel PNG, we'll scale it conceptually
function createMinimalPNG(size) {
  // For simplicity, create a minimal PNG header + IDAT chunk with solid color
  // This creates a blue square
  const width = size;
  const height = size;
  
  // PNG signature
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk (13 bytes data + 4 bytes CRC)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  
  const ihdrCRC = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdrChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 13]), // length
    Buffer.from('IHDR'),
    ihdrData,
    Buffer.from([
      (ihdrCRC >>> 24) & 0xFF,
      (ihdrCRC >>> 16) & 0xFF,
      (ihdrCRC >>> 8) & 0xFF,
      ihdrCRC & 0xFF
    ])
  ]);
  
  // Create image data: blue background (#4A90E2 = RGB 74, 144, 226)
  const rowSize = width * 3 + 1; // 3 bytes per pixel + 1 filter byte
  const imageData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    imageData[rowStart] = 0; // filter type (none)
    for (let x = 0; x < width; x++) {
      const offset = rowStart + 1 + x * 3;
      imageData[offset] = 74;     // R
      imageData[offset + 1] = 144; // G
      imageData[offset + 2] = 226; // B
    }
  }
  
  // Compress image data (simple deflate - for a solid color this is easy)
  const compressed = deflate(imageData);
  
  // IDAT chunk
  const idatCRC = crc32(Buffer.concat([Buffer.from('IDAT'), compressed]));
  const idatChunk = Buffer.concat([
    Buffer.from([
      (compressed.length >>> 24) & 0xFF,
      (compressed.length >>> 16) & 0xFF,
      (compressed.length >>> 8) & 0xFF,
      compressed.length & 0xFF
    ]),
    Buffer.from('IDAT'),
    compressed,
    Buffer.from([
      (idatCRC >>> 24) & 0xFF,
      (idatCRC >>> 16) & 0xFF,
      (idatCRC >>> 8) & 0xFF,
      idatCRC & 0xFF
    ])
  ]);
  
  // IEND chunk
  const iendCRC = crc32(Buffer.from('IEND'));
  const iendChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 0]), // length
    Buffer.from('IEND'),
    Buffer.from([
      (iendCRC >>> 24) & 0xFF,
      (iendCRC >>> 16) & 0xFF,
      (iendCRC >>> 8) & 0xFF,
      iendCRC & 0xFF
    ])
  ]);
  
  return Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);
}

// Simple CRC32 implementation
function crc32(buffer) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : (crc >>> 1);
    }
    table[i] = crc;
  }
  
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Simple deflate (for solid color, we can use a minimal deflate block)
function deflate(data) {
  // Minimal deflate: fixed Huffman codes, no compression for simplicity
  // This is a very basic implementation - for a solid color it works
  const output = Buffer.alloc(data.length + 20);
  let pos = 0;
  
  // BFINAL=1, BTYPE=00 (no compression)
  output[pos++] = 0x01; // last block, no compression
  
  // Length and nlen (one's complement)
  const len = data.length;
  output[pos++] = len & 0xFF;
  output[pos++] = (len >>> 8) & 0xFF;
  output[pos++] = (~len) & 0xFF;
  output[pos++] = ((~len) >>> 8) & 0xFF;
  
  data.copy(output, pos);
  pos += data.length;
  
  return output.slice(0, pos);
}

function main() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const outputPath = path.join(assetsDir, `icon${size}.png`);
    const pngData = createMinimalPNG(size);
    fs.writeFileSync(outputPath, pngData);
    console.log(`Created ${outputPath} (${size}x${size})`);
  }
  
  console.log(`\nIcons created in ${assetsDir}`);
}

main();

