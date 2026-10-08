// dist/ 폴더를 설치용 압축 파일(release/hanjang-capture-v<버전>.zip)로 묶는다. 외부 패키지 없이 zlib만 쓴다.
// 사용: npm run package  (빌드 후 실행된다)
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const { version } = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const OUT_DIR = join(ROOT, 'release');
const OUT = join(OUT_DIR, `hanjang-capture-v${version}.zip`);
// 압축을 풀면 이 이름의 폴더 하나가 나온다
const FOLDER = `hanjang-capture-v${version}`;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** MS-DOS 형식 날짜·시각 (압축 파일 안 파일의 수정 시각) */
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const files = walk(DIST).sort();
const locals = [];
const centrals = [];
let offset = 0;
const now = dosTime(new Date());
for (const file of files) {
  const name = Buffer.from(`${FOLDER}/${relative(DIST, file).split(sep).join('/')}`, 'utf8');
  const data = readFileSync(file);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // 파일 이름 UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(now.time, 10);
  local.writeUInt16LE(now.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, comp);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(now.time, 12);
  central.writeUInt16LE(now.date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += local.length + name.length + comp.length;
}
const centralSize = centrals.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, Buffer.concat([...locals, ...centrals, end]));
console.log(`${relative(ROOT, OUT)}: ${files.length} files, ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
