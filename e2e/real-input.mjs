// 실제 설치본과 같은 권한(activeTab만)으로, 가상 화면(Xvfb)에서 진짜 키보드·마우스 입력을 보내 "페이지 일부"를 시험한다.
// 자동 E2E(run.mjs)는 시험을 위해 모든 사이트 권한을 더한 복사본을 쓰므로, 권한 차이로 생기는 문제는 여기서 확인한다 (Issue #3).
// 필요: xvfb-run, xdotool, npm run build
// 사용: xvfb-run -a -s "-screen 0 2600x2000x24" node e2e/real-input.mjs /plain /framed
//   환경 변수: MODE=popup|shortcut, DPR=1|2, ZOOM=0.9, PRESCROLL=1500, HOLD=5000, SETTINGS='{"autoDownload":true}'
import { chromium } from 'playwright-core';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname;
const bands = (n) => Array.from({ length: n }, (_, i) => `<div style="height:500px;background:hsl(${i * 45},60%,50%)">${i}</div>`).join('');
const PAGES = {
  '/plain': `<!doctype html><html><body style="margin:0">${bands(8)}</body></html>`,
  '/framed': `<!doctype html><html style="height:100%;overflow:hidden"><body style="margin:0;height:100%;overflow:hidden"><iframe id="mainFrame" src="/post" style="display:block;border:0;width:100%;height:100%"></iframe></body></html>`,
  '/post': `<!doctype html><html><body style="margin:0">${bands(8)}</body></html>`,
};
const server = createServer((q, r) => r.end(PAGES[q.url.split('?')[0]] ?? '')).listen(0);
await new Promise((r) => server.on('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const extDir = mkdtempSync(join(tmpdir(), 'ext-'));
cpSync(join(ROOT, 'dist'), extDir, { recursive: true }); // 권한은 그대로 (activeTab만)
// 팝업(툴바 아이콘)을 진짜 키 입력으로 열 수 있게 시험용 복사본에만 단축키를 준다. 아이콘 클릭과 같이 activeTab이 생긴다
const mf = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
mf.commands._execute_action.suggested_key = { default: 'Ctrl+Shift+Y' };
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(mf));
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'p-')), {
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: false, viewport: null,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1000,800', '--window-position=0,0', `--force-device-scale-factor=${process.env.DPR || 1}`],
});
let w = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const logs = [];
const hook = (wk) => wk.on('console', (m) => logs.push(`[sw ${m.type()}] ${m.text()}`));
hook(w);
ctx.on('serviceworker', hook);
await new Promise((r) => setTimeout(r, 800));
const page = ctx.pages()[0];
page.on('console', (m) => logs.push(`[page ${m.type()}] ${m.text()}`));
async function attachPopup(context, page) {
  const cdp = await context.newCDPSession(page);
  let pop = null;
  for (let k = 0; k < 30 && !pop; k++) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    pop = targetInfos.find((t) => t.url.endsWith('/popup.html'));
    if (!pop) await new Promise((r) => setTimeout(r, 100));
  }
  if (!pop) throw new Error('popup not found');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: pop.targetId, flatten: false });
  let id = 0;
  const waiters = new Map();
  cdp.on('Target.receivedMessageFromTarget', (e) => {
    if (e.sessionId !== sessionId) return;
    const m = JSON.parse(e.message);
    waiters.get(m.id)?.(m);
    waiters.delete(m.id);
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      waiters.set(mid, res);
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: mid, method, params }) }).catch(() => res({}));
    });
  return {
    eval: async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value,
    screenshot: async (path) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      if (r.result) writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    },
  };
}
const X = (c) => execSync(`xdotool ${c}`, { env: { ...process.env } }).toString();
const MODE = process.env.MODE || 'shortcut';
if (process.env.SETTINGS) await w.evaluate((s) => chrome.storage.local.set({ settings: JSON.parse(s) }), process.env.SETTINGS);
const HOLD = Number(process.env.HOLD || 1200);
const PRESCROLL = Number(process.env.PRESCROLL || 0);
for (const path of process.argv.slice(2)) {
  logs.length = 0;
  await page.goto(origin + path);
  await page.bringToFront();
  if (process.env.ZOOM) await w.evaluate(async ([url, z]) => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); await chrome.tabs.setZoom(t.id, z); }, [origin + path, Number(process.env.ZOOM)]);
  if (PRESCROLL) await page.evaluate((y) => { scrollTo(0, y); const f = document.getElementById('mainFrame'); if (f) f.contentWindow.scrollTo(0, y); }, PRESCROLL);
  await page.waitForTimeout(500);
  // 창 안쪽 좌표 → 화면 좌표: 창 위치 + 브라우저 상단 높이
  // 화면 좌표 ↔ 페이지 좌표를 마우스를 두 번 움직여 잰다 (화면 배율·확대와 관계없이)
  try { X('search --onlyvisible --class chromium windowfocus --sync'); } catch {}
  await page.evaluate(() => {
    window.__mp = null;
    addEventListener('mousemove', (e) => (window.__mp = [e.clientX, e.clientY]), true);
    const f = document.getElementById('mainFrame');
    if (f) { const r = f.getBoundingClientRect(); f.contentWindow.addEventListener('mousemove', (e) => (window.__mp = [e.clientX + r.left, e.clientY + r.top]), true); }
  });
  const probe = async (sx, sy) => { X(`mousemove ${sx} ${sy}`); await page.waitForTimeout(150); X(`mousemove ${sx + 1} ${sy + 1}`); X(`mousemove ${sx} ${sy}`); await page.waitForTimeout(150); return page.evaluate(() => window.__mp); };
  const a = await probe(200, 300);
  const b = await probe(500, 600);
  const kx = (500 - 200) / (b[0] - a[0]);
  const ky = (600 - 300) / (b[1] - a[1]);
  const toScreen = (cx, cy) => [Math.round(200 + (cx - a[0]) * kx), Math.round(300 + (cy - a[1]) * ky)];
  const vh = await page.evaluate(() => innerHeight);
  try { X('search --onlyvisible --class chromium windowfocus --sync'); } catch (e) { console.log('focus fail', String(e.stderr)); }
  if (MODE === 'popup') {
    X('key --clearmodifiers ctrl+shift+y');
    const pop = await attachPopup(ctx, page).catch((e) => (console.log('popup?', String(e)), null));
    await page.waitForTimeout(400);
    if (pop) await pop.eval(`document.getElementById('choose-area').click()`);
  } else X('key --clearmodifiers ctrl+shift+e');
  const ok = await page.waitForFunction(() => !!document.getElementById('__hanjang-area'), null, { timeout: 4000 }).then(() => true, () => false);
  if (!ok) { console.log(path, '영역 덮개가 안 뜸', logs); continue; }
  const resultP = ctx.waitForEvent('page', { predicate: (p) => p.url().includes('result.html'), timeout: 40000 }).catch(() => null);
  X(`mousemove ${toScreen(100, 150).join(' ')}`);
  X('mousedown 1');
  for (let k = 1; k <= 6; k++) X(`mousemove ${toScreen(100 + k * 50, 150 + ((vh - 155) * k) / 6).join(' ')}`);
  await page.waitForTimeout(HOLD);
  const scrolled = await page.evaluate(() => Math.max(scrollY, document.getElementById('mainFrame')?.contentWindow.scrollY ?? 0));
  X('mouseup 1');
  await page.waitForTimeout(1500);
  const failed = await page.evaluate(() => document.documentElement.innerText.includes('찍지 못했어요'));
  const res = await resultP;
  console.log(path, JSON.stringify({ scrolled, failed, result: !!res }));
  for (const l of logs) console.log('   ', l);
  if (res) await res.close();
}
await ctx.close(); server.close();
