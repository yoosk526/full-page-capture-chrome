// 실제 Chromium(화면 없는 headless 모드)에 빌드한 확장 프로그램을 올려 촬영 흐름을 확인한다.
// 사용: npm run build && npm run e2e   (결과 이미지는 e2e/out/ 에 저장)
//
// 테스트 전용 차이: 사람이 툴바 아이콘을 누를 수 없으므로
// 1) 복사본 manifest에 host_permissions <all_urls>를 더해 activeTab(사용자 클릭) 대신 쓴다.
// 2) 팝업 대신 다른 창의 확장 페이지에서 팝업과 똑같은 메시지(open)를 서비스 워커로 보낸다.
import { chromium } from 'playwright-core';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from './fixtures.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'e2e/out');
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const extDir = mkdtempSync(join(tmpdir(), 'hanjang-ext-'));
  cpSync(join(ROOT, 'dist'), extDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const { server, origin } = await startServer();
  const userDir = mkdtempSync(join(tmpdir(), 'hanjang-profile-'));
  const context = await chromium.launchPersistentContext(userDir, {
    executablePath: EXEC,
    channel: 'chromium',
    headless: true,
    // 화면 크기 흉내(viewport)를 쓰면 실제로 찍히는 높이와 페이지가 아는 높이가 달라지므로 창 크기를 직접 정한다
    viewport: null,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--window-size=1000,800',
      `--force-device-scale-factor=${process.env.DPR || 1}`,
    ],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extId = new URL(worker.url()).host;
    check('서비스 워커가 뜬다', !!extId, extId);

    const consoleErrors = [];
    context.on('page', (p) => p.on('pageerror', (e) => consoleErrors.push(`${p.url()}: ${e.message}`)));

    for (const [name, path, expect] of [
      // pixels: [y(음수면 아래에서), 기대 색 판정, 설명]
      ['긴 페이지(스티키 머리글)', '/long.html', { minH: 3560, pixels: [[5, 'dark', '맨 위는 머리글'], [-5, 'not-white', '맨 아래까지 내용이 있음'], ['vh+5', 'not-dark', '두 번째 조각에 머리글이 반복되지 않음']] }],
      ['어두운 페이지', '/dark.html', { minH: 2400, pixels: [[-5, 'dark', '맨 아래도 어두운 바탕']] }],
      ['내부 스크롤 영역', '/inner.html', { minH: 2552, pixels: [[5, 'not-white', '앱 머리글 포함'], [-5, 'not-white', '바닥 막대 포함']] }],
    ]) {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(origin + path);
      await page.bringToFront();
      const tab = await worker.evaluate(async (url) => {
        const [t] = await chrome.tabs.query({ url });
        return { id: t.id, windowId: t.windowId };
      }, origin + path);

      // 다른 창에 확장 페이지를 열어 팝업 역할을 하게 한다
      const driverPromise = context.waitForEvent('page');
      await worker.evaluate(
        (url) => chrome.windows.create({ url, focused: false }),
        `chrome-extension://${extId}/result.html?id=driver`,
      );
      const driver = await driverPromise;
      await driver.waitForLoadState();
      const resultPromise = context.waitForEvent('page', (p) => p.url().includes('result.html?id=') && !p.url().includes('driver'));
      const progress = await driver.evaluate(
        (tab) =>
          new Promise((resolveDone) => {
            const port = chrome.runtime.connect({ name: 'capture-popup' });
            const seen = [];
            port.onMessage.addListener((m) => {
              seen.push(m);
              if (m.kind === 'done' || m.kind === 'error') resolveDone(seen);
            });
            port.postMessage({ kind: 'open', tabId: tab.id, windowId: tab.windowId });
          }),
        tab,
      );
      const last = progress.at(-1);
      check(`${name}: 촬영 완료 메시지`, last.kind === 'done', JSON.stringify(last));
      const maxTotal = Math.max(...progress.filter((m) => m.kind === 'progress').map((m) => m.total));
      check(`${name}: 진행 표시(조각 수)`, maxTotal >= 1, `조각 ${maxTotal}`);

      const result = await resultPromise;
      await result.waitForLoadState();
      await result.waitForSelector('#preview[src^="blob:"]');
      await result.waitForTimeout(300);
      const vh = await page.evaluate(() => Math.round(innerHeight * devicePixelRatio));
      const pixelYs = expect.pixels.map(([y]) => (y === 'vh+5' ? vh + 5 : y));
      const info = await result.evaluate(async (pixelYs) => {
        const id = new URLSearchParams(location.search).get('id');
        const db = await new Promise((r) => {
          const q = indexedDB.open('hanjang-capture');
          q.onsuccess = () => r(q.result);
        });
        const shot = await new Promise((r) => {
          const q = db.transaction('shots').objectStore('shots').get(id);
          q.onsuccess = () => r(q.result);
        });
        const buf = new Uint8Array(await shot.image.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const bmp = await createImageBitmap(shot.image);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const px = (y) => Array.from(ctx.getImageData(Math.floor(bmp.width / 2), y, 1, 1).data.slice(0, 3));
        return { width: shot.width, height: shot.height, links: shot.links.length, png: btoa(bin), vh: innerHeight, px: Object.fromEntries(pixelYs.map((y) => [y, px(y < 0 ? bmp.height + y : y)])) };
      }, pixelYs);
      const file = join(OUT, `${path.slice(1).replace('.html', '')}.png`);
      writeFileSync(file, Buffer.from(info.png, 'base64'));
      check(`${name}: 보관된 이미지 크기`, info.height >= expect.minH, `${info.width}x${info.height}, 링크 ${info.links}`);
      expect.pixels.forEach(([, kind, label], k) => {
        const [r, g, b] = info.px[pixelYs[k]];
        const lum = (r + g + b) / 3;
        const ok = kind === 'dark' ? lum < 40 : kind === 'not-dark' ? lum >= 40 : lum < 245;
        check(`${name}: ${label}`, ok, `y=${pixelYs[k]} rgb(${r},${g},${b})`);
      });
      await result.screenshot({ path: join(OUT, `result-${path.slice(1).replace('.html', '')}.png`) });
      await result.close();
      await driver.close();
    }

    check('페이지 스크립트 오류 없음', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await context.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
