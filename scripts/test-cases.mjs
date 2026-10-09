// docs/TEST_CASES.md를 테스트 코드와 실제 실행 결과로 만든다 (손으로 고치면 어긋나므로 자동 생성)
// 사용: npm run test:doc
// 규칙: 테스트 이름은 "[EP|BVA] TC-xxx 입력 → 기대 결과", 바로 위 주석은 "// 목적: ..."
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TEST_DIR = join(ROOT, 'tests');

const json = execSync('npx vitest run --reporter=json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const report = JSON.parse(json.slice(json.indexOf('{')));
const status = new Map();
for (const file of report.testResults) {
  for (const a of file.assertionResults) status.set(a.title, a.status);
}

const rows = [];
const problems = [];
for (const f of readdirSync(TEST_DIR).filter((n) => n.endsWith('.test.ts')).sort()) {
  const lines = readFileSync(join(TEST_DIR, f), 'utf8').split('\n');
  let feature = '';
  lines.forEach((line, i) => {
    const d = line.match(/^\s*describe\('([^']+)'/);
    if (d) feature = d[1];
    const m = line.match(/^\s*it\('(\[(EP|BVA)\] (TC-[A-Z0-9-]+) (.+))'/);
    if (!m) {
      if (/^\s*it\(/.test(line)) problems.push(`${f}:${i + 1} 이름 규칙 위반`);
      return;
    }
    const [, title, tech, id, rest] = m;
    const purposeLine = lines[i - 1].match(/\/\/ 목적: (.+)/);
    if (!purposeLine) problems.push(`${f}:${i + 1} ${id} 목적 주석 없음`);
    const [input, expected] = rest.includes('→') ? rest.split('→').map((s) => s.trim()) : [rest, ''];
    if (!expected) problems.push(`${f}:${i + 1} ${id} 이름에 "입력 → 기대 결과" 형식이 없음`);
    const st = status.get(title);
    rows.push({ id, feature, tech, purpose: purposeLine?.[1] ?? '', input, expected, result: st === 'passed' ? '통과' : st === 'failed' ? '실패' : '실행 안 됨' });
  });
}

const ids = new Set();
for (const r of rows) {
  if (ids.has(r.id)) problems.push(`ID 중복: ${r.id}`);
  ids.add(r.id);
}

const esc = (s) => s.replace(/\|/g, '\\|');
const count = (t) => rows.filter((r) => r.tech === t).length;
const passed = rows.filter((r) => r.result === '통과').length;
const out = [
  '# 테스트 케이스 목록 (TEST_CASES.md)',
  '',
  '> 이 문서는 `npm run test:doc`이 테스트 코드(`tests/*.test.ts`)와 실제 실행 결과로 자동으로 만든다. 손으로 고치지 않는다.',
  '>',
  '> 기법: **EP**(동치 분할: 입력을 같은 결과를 내는 묶음으로 나누고 묶음마다 대표값 하나만 시험) / **BVA**(경계값 분석: 최솟값·최댓값 바로 앞뒤를 시험)',
  '',
  `- 전체 ${rows.length}건 (EP ${count('EP')}건, BVA ${count('BVA')}건)`,
  `- 실행 결과: 통과 ${passed}건, 실패 ${rows.filter((r) => r.result === '실패').length}건`,
  `- 생성 시각: ${new Date().toISOString()}`,
  '',
  '| ID | 대상 기능 | 기법(EP/BVA) | 목적(막으려는 결함) | 입력 | 기대 결과 | 실행 결과 |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${esc(r.feature)} | ${r.tech} | ${esc(r.purpose)} | ${esc(r.input)} | ${esc(r.expected)} | ${r.result} |`),
  '',
];
writeFileSync(join(ROOT, 'docs/TEST_CASES.md'), out.join('\n'));
console.log(`TEST_CASES.md: ${rows.length} rows (EP ${count('EP')}, BVA ${count('BVA')}), passed ${passed}`);
if (problems.length) {
  console.error('규칙 위반:\n' + problems.join('\n'));
  process.exit(1);
}
