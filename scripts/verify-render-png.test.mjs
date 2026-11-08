import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { crc32, parsePng } from './verify-render-png.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./verify-render-png.mjs', import.meta.url));
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('parses a dependency-free RGBA PNG and validates dimensions', () => {
  const png = makePng({ width: 4, height: 4 });
  const parsed = parsePng(png);

  assert.equal(parsed.width, 4);
  assert.equal(parsed.height, 4);
  assert.equal(parsed.bitDepth, 8);
  assert.equal(parsed.colorType, 6);
  assert.equal(parsed.pixels.length, 4);
});

test('rejects a PNG with an invalid chunk CRC', () => {
  const png = Buffer.from(makePng({ width: 4, height: 4 }));
  png[png.length - 1] ^= 0xff;

  assert.throws(() => parsePng(png), /invalid CRC/);
});

test('CLI exits nonzero on exact dimension mismatch and emits JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-render-png-'));
  const pngPath = join(dir, 'fixture.png');
  writeFileSync(pngPath, makePng({ width: 4, height: 4 }));

  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, pngPath, '--expect-width', '5', '--expect-height', '4'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.match(report.issues.join('\n'), /width mismatch: expected 5, got 4/);
});

test('CLI help exits successfully', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--help'], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

function makePng({ width, height }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = (x * 67) & 0xff;
      row[offset + 1] = (y * 83) & 0xff;
      row[offset + 2] = ((x + y) * 41) & 0xff;
      row[offset + 3] = 255;
    }
    rows.push(row);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(Buffer.concat(rows))),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}
