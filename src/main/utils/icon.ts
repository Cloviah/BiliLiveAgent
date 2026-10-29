import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * 生成一张简洁的占位图标（深底 + 青色圆角方块 + 橙色圆点），
 * 用于窗口与托盘，不依赖任何第三方素材。
 */
export function createAppIcon(size = 64): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const inset = Math.round(size * 0.16);
  const radius = Math.round(size * 0.18);

  const insideRounded = (x: number, y: number): boolean => {
    const left = inset;
    const right = size - inset;
    const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
    const cy = y < left + radius ? left + radius : y > right - radius ? right - radius : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  const dotCenter = { x: size * 0.5, y: size * 0.5 };
  const dotRadius = size * 0.12;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      pixels[i] = 0x0b;
      pixels[i + 1] = 0x12;
      pixels[i + 2] = 0x20;
      pixels[i + 3] = 0xff;
      if (insideRounded(x, y)) {
        pixels[i] = 0x2b;
        pixels[i + 1] = 0xd9;
        pixels[i + 2] = 0xc4;
        pixels[i + 3] = 0xff;
      }
      const ddx = x - dotCenter.x;
      const ddy = y - dotCenter.y;
      if (ddx * ddx + ddy * ddy <= dotRadius * dotRadius) {
        pixels[i] = 0xff;
        pixels[i + 1] = 0x8a;
        pixels[i + 2] = 0x4c;
        pixels[i + 3] = 0xff;
      }
    }
  }

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
