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

/** 편집기: 도구로 개체를 만들고 실행 취소·자르기·도장을 확인한다 */
async function editorFlow(context, extId, id) {
  const ed = await context.newPage();
  await ed.setViewportSize({ width: 1280, height: 800 }).catch(() => undefined);
  await ed.goto(`chrome-extension://${extId}/editor.html?id=${id}`);
  await ed.waitForSelector('#toolbar [data-tool]');
  await ed.waitForTimeout(300);
  const box = await ed.locator('#view').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const dragBy = async (tool, [x0, y0], [x1, y1]) => {
    await ed.keyboard.press(tool);
    await ed.mouse.move(x0, y0);
    await ed.mouse.down();
    for (let k = 1; k <= 5; k++) await ed.mouse.move(x0 + ((x1 - x0) * k) / 5, y0 + ((y1 - y0) * k) / 5);
    await ed.mouse.up();
  };
  const status = () => ed.locator('#status').textContent();

  check('편집기: 처음 비율 75%', (await ed.locator('#zoom-label').textContent()) === '75%');
  check('편집기: 처음엔 실행 취소 비활성', await ed.locator('#undo-btn').isDisabled());
  await dragBy('r', at(0.2, 0.2), at(0.45, 0.35));
  await dragBy('a', at(0.5, 0.5), at(0.7, 0.3));
  await dragBy('o', at(0.2, 0.5), at(0.35, 0.65));
  await dragBy('l', at(0.1, 0.8), at(0.4, 0.85));
  await dragBy('b', at(0.55, 0.6), at(0.75, 0.75));
  await dragBy('h', at(0.1, 0.1), at(0.3, 0.12));
  await dragBy('p', at(0.6, 0.15), at(0.8, 0.25));
  await dragBy('m', at(0.6, 0.25), at(0.8, 0.35));
  await ed.keyboard.press('n');
  await ed.mouse.click(...at(0.85, 0.5));
  await ed.mouse.click(...at(0.85, 0.65));
  await ed.keyboard.press('t');
  await ed.mouse.click(...at(0.3, 0.9));
  await ed.keyboard.type('안녕하세요 테스트');
  await ed.keyboard.press('Escape');
  await ed.waitForTimeout(100);
  const s1 = await status();
  check('편집기: 개체 11개 만들기(도구 10종)', s1.includes('개체 11개'), s1);
  const names = await ed.locator('#objects-list .name').allTextContents();
  check('편집기: 번호 표시는 1, 2 순서로 올라감', names.includes('번호 1') && names.includes('번호 2'), names.join(','));
  check('편집기: 목록 맨 위가 가장 나중 개체(텍스트)', names[0] === '텍스트', names[0]);

  await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  check('편집기: 실행 취소 → 10개', (await status()).includes('개체 10개'), await status());
  await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+y' : 'Control+y');
  check('편집기: 다시 실행 → 11개', (await status()).includes('개체 11개'), await status());

  // 선택 → 복제 → 삭제
  await ed.keyboard.press('v');
  await ed.locator('#objects-list li').nth(3).click();
  await ed.keyboard.press('Control+d');
  check('편집기: 복제(Ctrl+D) → 12개', (await status()).includes('개체 12개'), await status());
  await ed.keyboard.press('Delete');
  check('편집기: 지우기(Delete) → 11개', (await status()).includes('개체 11개'), await status());

  // 개체를 고르면 오른쪽 패널에 그 개체의 스타일이 나온다 → 색 바꾸기
  await ed.locator('#objects-list li', { hasText: '사각형' }).click();
  const panelText = await ed.locator('#style-panel').textContent();
  check('편집기: 사각형을 고르면 색·채우기·두께·모서리 항목', ['색', '채우기', '두께', '모서리 둥글기'].every((w) => panelText.includes(w)), panelText);
  await ed.locator('#style-panel .field').first().locator('.swatch[title="초록"]').click();
  const dot = await ed.locator('#objects-list li', { hasText: '사각형' }).locator('.icon-btn').count();
  const color = await ed.evaluate(() => getComputedStyle(document.querySelector('#style-panel .swatch.selected')).backgroundColor);
  check('편집기: 색 바꾸기(초록) 반영', color === 'rgb(48, 164, 108)' && dot === 3, color);
  await ed.keyboard.press('Escape');

  // 도장 켜기(U) → 결과 크기가 커진다
  const before = await status();
  await ed.keyboard.press('u');
  const after = await status();
  check('편집기: U로 주소·날짜 도장 켜기 → 결과 높이 증가', before !== after, `${before} → ${after}`);
  await ed.screenshot({ path: join(OUT, 'editor.png') });

  // 자르기: C → 오른쪽 아래 핸들을 안쪽으로 → Enter
  await ed.keyboard.press('c');
  await ed.waitForTimeout(200);
  await ed.screenshot({ path: join(OUT, 'editor-crop.png') });
  // 자르기 화면은 전체 맞춤이라 이미지가 가운데에 있다 → 오른쪽 변 가운데 핸들을 왼쪽으로 끈다
  const vb = await ed.locator('#view').boundingBox();
  const z = parseFloat(await ed.locator('#zoom-label').textContent()) / 100;
  const ex = vb.x + vb.width / 2 + (1000 * z) / 2;
  const ey = vb.y + vb.height / 2;
  await ed.mouse.move(ex, ey);
  await ed.mouse.down();
  await ed.mouse.move(ex - 50, ey, { steps: 5 });
  await ed.mouse.up();
  await ed.keyboard.press('Enter');
  await ed.waitForTimeout(100);
  const cropped = await status();
  check('편집기: 자르기 적용 → 크기 줄어듦', cropped !== after, cropped);
  await ed.keyboard.press('Shift+?');
  check('편집기: Shift+?로 단축키 창', await ed.locator('#shortcuts-dialog').isVisible());
  await ed.screenshot({ path: join(OUT, 'editor-shortcuts.png') });
  await ed.keyboard.press('Escape');

  // 뒤로 → 결과 화면에 편집 내용 반영 (RES-08)
  await ed.locator('#back-btn').click();
  await ed.waitForURL(/result\.html/);
  await ed.waitForSelector('#preview[src^="blob:"]');
  await ed.waitForTimeout(500);
  const size = await ed.locator('#image-size').textContent();
  check('결과 화면: 편집(자르기) 반영된 크기', cropped.startsWith(size.replace(' px', '')), `${size} / ${cropped}`);
  await ed.screenshot({ path: join(OUT, 'result-edited.png') });
  await ed.close();
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

    const shotIds = {};
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
      shotIds[path] = new URL(result.url()).searchParams.get('id');
      await result.close();
      await driver.close();
    }

    await editorFlow(context, extId, shotIds['/long.html']);

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
