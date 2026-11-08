#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

const DEFAULTS = {
  minNonWhiteRatio: 0.02,
  minCoverageRatio: 0.08,
  minLuminanceStdDev: 8,
  whiteDistanceThreshold: 18,
  transparentAlphaThreshold: 16,
  sampleTarget: 160000,
  coverageColumns: 12,
  coverageRows: 12,
};

function usage() {
  return [
    'Usage: node scripts/verify-render-png.mjs <png-path> [--expect-width N] [--expect-height N] [--json-out path]',
    '',
    'Fails when the PNG is mostly blank or has too little visible pixel variation.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    pngPath: undefined,
    expectWidth: undefined,
    expectHeight: undefined,
    jsonOut: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--expect-width') {
      args.expectWidth = parsePositiveInt(argv[index + 1], value);
      index += 1;
    } else if (value === '--expect-height') {
      args.expectHeight = parsePositiveInt(argv[index + 1], value);
      index += 1;
    } else if (value === '--json-out') {
      args.jsonOut = argv[index + 1];
      if (!args.jsonOut) {
        throw new Error('--json-out requires a path');
      }
      index += 1;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    } else if (!args.pngPath) {
      args.pngPath = value;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return args;
}

function parsePositiveInt(value, name) {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} requires a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} requires a positive integer`);
  }
  return parsed;
}

function readChunks(buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('File is not a PNG: invalid signature');
  }

  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  let sawIend = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    validateChunkType(type);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buffer.length) {
      throw new Error(`PNG chunk ${type} extends beyond file size`);
    }
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw new Error(`PNG chunk ${type} has invalid CRC`);
    }
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd), length });
    offset = crcEnd;
    if (type === 'IEND') {
      sawIend = true;
      break;
    }
  }

  if (!sawIend) {
    throw new Error('PNG is missing IEND chunk');
  }
  if (offset !== buffer.length) {
    throw new Error('PNG has trailing data after IEND');
  }
  validateChunkSequence(chunks);
  return chunks;
}

function validateChunkType(type) {
  if (!/^[A-Za-z]{4}$/.test(type)) {
    throw new Error(`PNG chunk has invalid type: ${JSON.stringify(type)}`);
  }
}

function validateChunkSequence(chunks) {
  if (chunks.length < 3) {
    throw new Error('PNG is missing required chunks');
  }
  if (chunks[0].type !== 'IHDR') {
    throw new Error('PNG first chunk must be IHDR');
  }
  if (chunks[chunks.length - 1].type !== 'IEND') {
    throw new Error('PNG final chunk must be IEND');
  }

  let ihdrCount = 0;
  let iendCount = 0;
  let idatCount = 0;
  let seenIdat = false;
  let seenChunkAfterIdat = false;
  let seenPlte = false;

  for (const chunk of chunks) {
    if (chunk.type === 'IHDR') {
      ihdrCount += 1;
      if (ihdrCount > 1) {
        throw new Error('PNG contains multiple IHDR chunks');
      }
    } else if (chunk.type === 'IEND') {
      iendCount += 1;
      if (chunk.length !== 0) {
        throw new Error('PNG IEND chunk must be empty');
      }
      if (iendCount > 1) {
        throw new Error('PNG contains multiple IEND chunks');
      }
    } else if (chunk.type === 'PLTE') {
      if (seenIdat) {
        throw new Error('PNG PLTE chunk must appear before IDAT');
      }
      seenPlte = true;
    } else if (chunk.type === 'IDAT') {
      if (seenChunkAfterIdat) {
        throw new Error('PNG IDAT chunks must be consecutive');
      }
      seenIdat = true;
      idatCount += 1;
    } else if (seenIdat) {
      seenChunkAfterIdat = true;
    }
  }

  if (ihdrCount !== 1) {
    throw new Error('PNG is missing IHDR chunk');
  }
  if (idatCount === 0) {
    throw new Error('PNG is missing IDAT image data');
  }
  if (iendCount !== 1) {
    throw new Error('PNG is missing IEND chunk');
  }

  const ihdr = chunks[0];
  if (ihdr.data.length !== 13) {
    throw new Error('PNG IHDR chunk must be 13 bytes');
  }
  const colorType = ihdr.data.readUInt8(9);
  if (colorType === 3 && !seenPlte) {
    throw new Error('Indexed-color PNG is missing required PLTE chunk');
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks[0];

  const info = {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data.readUInt8(8),
    colorType: ihdr.data.readUInt8(9),
    compression: ihdr.data.readUInt8(10),
    filter: ihdr.data.readUInt8(11),
    interlace: ihdr.data.readUInt8(12),
    palette: undefined,
    transparency: undefined,
  };

  if (info.width <= 0 || info.height <= 0) {
    throw new Error('PNG has invalid dimensions');
  }
  if (info.compression !== 0 || info.filter !== 0) {
    throw new Error('PNG uses unsupported compression or filter method');
  }
  if (info.interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported by this verifier');
  }

  const idatParts = [];
  for (const chunk of chunks) {
    if (chunk.type === 'PLTE') {
      info.palette = parsePalette(chunk.data);
    } else if (chunk.type === 'tRNS') {
      info.transparency = chunk.data;
    } else if (chunk.type === 'IDAT') {
      idatParts.push(chunk.data);
    }
  }

  if (idatParts.length === 0) {
    throw new Error('PNG is missing IDAT image data');
  }

  const inflated = inflateSync(Buffer.concat(idatParts));
  return {
    ...info,
    pixels: decodePixels(info, inflated),
  };
}

function parsePalette(data) {
  if (data.length % 3 !== 0) {
    throw new Error('PNG has invalid PLTE chunk length');
  }
  const palette = [];
  for (let index = 0; index < data.length; index += 3) {
    palette.push([data[index], data[index + 1], data[index + 2]]);
  }
  return palette;
}

function channelsForColorType(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type: ${colorType}`);
}

function validateBitDepth(colorType, bitDepth) {
  const allowed = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!allowed[colorType]?.includes(bitDepth)) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth} for color type ${colorType}`);
  }
}

function decodePixels(info, inflated) {
  validateBitDepth(info.colorType, info.bitDepth);

  const channels = channelsForColorType(info.colorType);
  const bitsPerPixel = channels * info.bitDepth;
  const bytesPerScanline = Math.ceil((info.width * bitsPerPixel) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const expectedLength = info.height * (1 + bytesPerScanline);
  if (inflated.length < expectedLength) {
    throw new Error(`Inflated PNG data is too short: expected at least ${expectedLength}, got ${inflated.length}`);
  }

  const rows = new Array(info.height);
  let offset = 0;
  let previous = Buffer.alloc(bytesPerScanline);

  for (let y = 0; y < info.height; y += 1) {
    const filterType = inflated[offset];
    offset += 1;
    const scanline = Buffer.from(inflated.subarray(offset, offset + bytesPerScanline));
    offset += bytesPerScanline;
    const row = unfilterScanline(filterType, scanline, previous, bytesPerPixel);
    rows[y] = row;
    previous = row;
  }

  return rows;
}

function unfilterScanline(filterType, scanline, previous, bytesPerPixel) {
  const output = Buffer.alloc(scanline.length);
  for (let index = 0; index < scanline.length; index += 1) {
    const raw = scanline[index];
    const left = index >= bytesPerPixel ? output[index - bytesPerPixel] : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] ?? 0 : 0;
    let value;

    if (filterType === 0) {
      value = raw;
    } else if (filterType === 1) {
      value = raw + left;
    } else if (filterType === 2) {
      value = raw + up;
    } else if (filterType === 3) {
      value = raw + Math.floor((left + up) / 2);
    } else if (filterType === 4) {
      value = raw + paethPredictor(left, up, upLeft);
    } else {
      throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }

    output[index] = value & 0xff;
  }
  return output;
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function pixelAt(info, x, y) {
  const row = info.pixels[y];
  if (info.bitDepth < 8) {
    return packedPixelAt(info, row, x);
  }

  const bytesPerSample = info.bitDepth === 16 ? 2 : 1;
  const channels = channelsForColorType(info.colorType);
  const offset = x * channels * bytesPerSample;
  const sample = (channelIndex) => {
    const position = offset + channelIndex * bytesPerSample;
    return bytesPerSample === 2 ? row[position] : row[position];
  };

  if (info.colorType === 0) {
    const gray = sample(0);
    return { r: gray, g: gray, b: gray, a: alphaFromTransparency(info, gray) };
  }
  if (info.colorType === 2) {
    const r = sample(0);
    const g = sample(1);
    const b = sample(2);
    return { r, g, b, a: rgbAlphaFromTransparency(info, r, g, b) };
  }
  if (info.colorType === 3) {
    return palettePixel(info, sample(0));
  }
  if (info.colorType === 4) {
    const gray = sample(0);
    return { r: gray, g: gray, b: gray, a: sample(1) };
  }
  if (info.colorType === 6) {
    return { r: sample(0), g: sample(1), b: sample(2), a: sample(3) };
  }
  throw new Error(`Unsupported PNG color type: ${info.colorType}`);
}

function packedPixelAt(info, row, x) {
  const bitDepth = info.bitDepth;
  const mask = (1 << bitDepth) - 1;
  const bitOffset = x * bitDepth;
  const byte = row[Math.floor(bitOffset / 8)];
  const shift = 8 - bitDepth - (bitOffset % 8);
  const value = (byte >> shift) & mask;

  if (info.colorType === 3) {
    return palettePixel(info, value);
  }

  const scaled = Math.round((value / mask) * 255);
  return { r: scaled, g: scaled, b: scaled, a: alphaFromTransparency(info, value) };
}

function palettePixel(info, paletteIndex) {
  if (!info.palette?.[paletteIndex]) {
    throw new Error(`PNG references missing palette index ${paletteIndex}`);
  }
  const [r, g, b] = info.palette[paletteIndex];
  const alpha = info.transparency?.[paletteIndex] ?? 255;
  return { r, g, b, a: alpha };
}

function alphaFromTransparency(info, gray) {
  if (!info.transparency || info.transparency.length < 2) {
    return 255;
  }
  const transparentGray = info.bitDepth === 16 ? info.transparency.readUInt16BE(0) >> 8 : info.transparency.readUInt16BE(0);
  return gray === transparentGray ? 0 : 255;
}

function rgbAlphaFromTransparency(info, r, g, b) {
  if (!info.transparency || info.transparency.length < 6) {
    return 255;
  }
  const transparent = [
    info.transparency.readUInt16BE(0),
    info.transparency.readUInt16BE(2),
    info.transparency.readUInt16BE(4),
  ].map((value) => (info.bitDepth === 16 ? value >> 8 : value));
  return r === transparent[0] && g === transparent[1] && b === transparent[2] ? 0 : 255;
}

function analyzePng(buffer, parsed, args) {
  const totalPixels = parsed.width * parsed.height;
  const sampleStep = Math.max(1, Math.floor(Math.sqrt(totalPixels / DEFAULTS.sampleTarget)));
  const coverageCells = new Set();
  let sampledPixels = 0;
  let visiblePixels = 0;
  let nonWhitePixels = 0;
  let transparentPixels = 0;
  let luminanceMean = 0;
  let luminanceM2 = 0;
  let minLuminance = 255;
  let maxLuminance = 0;

  for (let y = 0; y < parsed.height; y += sampleStep) {
    for (let x = 0; x < parsed.width; x += sampleStep) {
      const pixel = pixelAt(parsed, x, y);
      sampledPixels += 1;
      if (pixel.a < DEFAULTS.transparentAlphaThreshold) {
        transparentPixels += 1;
        continue;
      }

      visiblePixels += 1;
      const luminance = 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b;
      const delta = luminance - luminanceMean;
      luminanceMean += delta / visiblePixels;
      luminanceM2 += delta * (luminance - luminanceMean);
      minLuminance = Math.min(minLuminance, luminance);
      maxLuminance = Math.max(maxLuminance, luminance);

      if (!isNearWhite(pixel)) {
        nonWhitePixels += 1;
        const cellX = Math.min(DEFAULTS.coverageColumns - 1, Math.floor((x / parsed.width) * DEFAULTS.coverageColumns));
        const cellY = Math.min(DEFAULTS.coverageRows - 1, Math.floor((y / parsed.height) * DEFAULTS.coverageRows));
        coverageCells.add(`${cellX},${cellY}`);
      }
    }
  }

  const visibleRatio = sampledPixels === 0 ? 0 : visiblePixels / sampledPixels;
  const nonWhiteRatio = visiblePixels === 0 ? 0 : nonWhitePixels / visiblePixels;
  const transparentRatio = sampledPixels === 0 ? 0 : transparentPixels / sampledPixels;
  const coverageRatio = coverageCells.size / (DEFAULTS.coverageColumns * DEFAULTS.coverageRows);
  const luminanceVariance = visiblePixels > 1 ? luminanceM2 / (visiblePixels - 1) : 0;
  const luminanceStdDev = Math.sqrt(luminanceVariance);
  const issues = [];

  if (args.expectWidth && parsed.width !== args.expectWidth) {
    issues.push(`width mismatch: expected ${args.expectWidth}, got ${parsed.width}`);
  }
  if (args.expectHeight && parsed.height !== args.expectHeight) {
    issues.push(`height mismatch: expected ${args.expectHeight}, got ${parsed.height}`);
  }
  if (visiblePixels === 0) {
    issues.push('image has no visible pixels');
  }
  if (nonWhiteRatio < DEFAULTS.minNonWhiteRatio) {
    issues.push(`mostly blank or low-content image: nonWhiteRatio ${formatRatio(nonWhiteRatio)} is below ${DEFAULTS.minNonWhiteRatio}`);
  }
  if (coverageRatio < DEFAULTS.minCoverageRatio) {
    issues.push(`content coverage too low: coverageRatio ${formatRatio(coverageRatio)} is below ${DEFAULTS.minCoverageRatio}`);
  }
  if (luminanceStdDev < DEFAULTS.minLuminanceStdDev) {
    issues.push(`visible pixel variance too low: luminanceStdDev ${luminanceStdDev.toFixed(2)} is below ${DEFAULTS.minLuminanceStdDev}`);
  }

  return {
    ok: issues.length === 0,
    path: args.pngPath,
    width: parsed.width,
    height: parsed.height,
    byteSize: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    png: {
      bitDepth: parsed.bitDepth,
      colorType: parsed.colorType,
      interlace: parsed.interlace,
      chunksValidated: true,
    },
    sampledPixels,
    sampleStep,
    visibleRatio: roundMetric(visibleRatio),
    transparentRatio: roundMetric(transparentRatio),
    nonWhiteRatio: roundMetric(nonWhiteRatio),
    contentRatio: roundMetric(nonWhiteRatio),
    coverageRatio: roundMetric(coverageRatio),
    nonWhitePixels,
    visiblePixels,
    luminance: {
      mean: roundMetric(luminanceMean),
      min: roundMetric(minLuminance),
      max: roundMetric(maxLuminance),
      variance: roundMetric(luminanceVariance),
      stdDev: roundMetric(luminanceStdDev),
    },
    thresholds: {
      minNonWhiteRatio: DEFAULTS.minNonWhiteRatio,
      minCoverageRatio: DEFAULTS.minCoverageRatio,
      minLuminanceStdDev: DEFAULTS.minLuminanceStdDev,
      whiteDistanceThreshold: DEFAULTS.whiteDistanceThreshold,
    },
    issues,
  };
}

function isNearWhite(pixel) {
  const distance = Math.sqrt(
    (255 - pixel.r) ** 2 +
      (255 - pixel.g) ** 2 +
      (255 - pixel.b) ** 2,
  );
  return distance <= DEFAULTS.whiteDistanceThreshold;
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

function formatRatio(value) {
  return value.toFixed(6);
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!args.pngPath) {
      throw new Error('Missing PNG path');
    }
    if (!existsSync(args.pngPath)) {
      throw new Error(`PNG file does not exist: ${args.pngPath}`);
    }

    const buffer = readFileSync(args.pngPath);
    const parsed = parsePng(buffer);
    const report = analyzePng(buffer, parsed, args);
    if (args.jsonOut) {
      writeJson(args.jsonOut, report);
    }
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    const report = {
      ok: false,
      path: args?.pngPath,
      error: error instanceof Error ? error.message : String(error),
      issues: [error instanceof Error ? error.message : String(error)],
    };
    if (args?.jsonOut) {
      writeJson(args.jsonOut, report);
    }
    console.error(JSON.stringify(report, null, 2));
    process.exit(2);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export {
  analyzePng,
  crc32,
  parseArgs,
  parsePng,
  readChunks,
};
