// 확장 프로그램 아이콘(PNG)을 만든다. 외부 패키지 없이 Node 기본 zlib만 쓴다.
// 모양: 파란 둥근 사각형 위에 흰 카메라 (PR #1 두 번째 요청: 한눈에 카메라로 보이게)
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
  if (!inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.2)) return [0, 0, 0, 0];
  const d = Math.hypot(x - 0.5, y - 0.555);
  const inBody = inRoundRect(x, y, 0.15, 0.3, 0.85, 0.78, 0.08);
  // 몸통 위 셔터 부분(사다리꼴)
  const inTop = y >= 0.21 && y <= 0.31 && Math.abs(x - 0.5) <= 0.12 + (y - 0.21) * 0.6;
  if (!inBody && !inTop) return BLUE;
  // 렌즈: 파란 고리 + 흰 안쪽
  if (d <= 0.175 && d > 0.105) return BLUE;
  return WHITE;
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
