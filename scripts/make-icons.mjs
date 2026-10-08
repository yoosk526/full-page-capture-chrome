// 확장 프로그램 아이콘(PNG)을 만든다. 외부 패키지 없이 Node 기본 zlib만 쓴다.
// 모양: 파란 둥근 사각형 위에 긴 흰 종이(전체 페이지)와 아래로 향하는 화살표
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const SS = 4; // 가장자리를 부드럽게 하려고 4배로 그린 뒤 평균을 낸다

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** 0..1 좌표에서 색을 고른다 */
function colorAt(x, y) {
  const BLUE = [43, 108, 222, 255];
  const WHITE = [255, 255, 255, 255];
  const LINE = [170, 192, 232, 255];
  if (!inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) return [0, 0, 0, 0];
  // 종이
  if (inRoundRect(x, y, 0.27, 0.12, 0.73, 0.7, 0.05)) {
    for (const ly of [0.24, 0.36, 0.48]) if (y > ly && y < ly + 0.06 && x > 0.35 && x < 0.65) return LINE;
    return WHITE;
  }
  // 아래 화살표
  const ax = Math.abs(x - 0.5);
  if (y > 0.74 && y < 0.9 && ax < 0.17 - (y - 0.74) * 1.05 && ax > 0.17 - (y - 0.74) * 1.05 - 0.09) return WHITE;
  return BLUE;
}

mkdirSync('public/icons', { recursive: true });
for (const size of SIZES) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const i = (py * size + px) * 4;
      const a = acc[3];
      buf[i] = a ? Math.round(acc[0] / a) : 0;
      buf[i + 1] = a ? Math.round(acc[1] / a) : 0;
      buf[i + 2] = a ? Math.round(acc[2] / a) : 0;
      buf[i + 3] = Math.round(a / (SS * SS));
    }
  }
  writeFileSync(`public/icons/icon${size}.png`, png(size, buf));
}
console.log('icons written:', SIZES.join(', '));
