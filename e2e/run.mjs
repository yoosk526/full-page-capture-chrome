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

/** 결과 화면에서 PNG / JPG / PDF 저장, 하위 폴더, 복사 */
async function exportFlow(context, worker, extId, id) {
  await worker.evaluate(() =>
    chrome.storage.local.set({ settings: { saveFolder: 'shots', pdfPaper: 'a4', pdfHeader: true, pdfLinks: true, pdfSmartBreak: true } }),
  );
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/result.html?id=${id}`);
  await page.waitForSelector('#preview[src^="blob:"]');
  await page.evaluate(() => {
    window.__requested = [];
    const orig = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = (opts) => {
      window.__requested.push(opts.filename);
      return orig(opts);
    };
  });
  const waitDownload = async (ext) =>
    worker.evaluate(async (ext) => {
      for (let k = 0; k < 100; k++) {
        const items = await chrome.downloads.search({ orderBy: ['-startTime'], mime: ext === 'pdf' ? 'application/pdf' : ext === 'jpg' ? 'image/jpeg' : 'image/png' });
        const d = items[0];
        if (d && d.state === 'complete') return { filename: d.filename, size: d.fileSize };
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    }, ext);
  const magic = { png: '89504e47', jpg: 'ffd8ff', pdf: '25504446' };
  for (const fmt of ['png', 'jpg', 'pdf']) {
    await page.locator('#save-more').click();
    await page.locator(`#save-menu button[data-format="${fmt}"]`).click();
    const d = await waitDownload(fmt);
    // Playwright는 내려받은 파일을 임시 폴더에 다른 이름으로 두므로, 확장이 요청한 경로는 따로 기록해 본다
    const requested = await page.evaluate(() => window.__requested.at(-1));
    const ok = !!d && readFileSync(d.filename).subarray(0, 4).toString('hex').startsWith(magic[fmt]);
    check(`저장: ${fmt.toUpperCase()} 파일 내용이 맞고 shots 폴더로 요청됨`, ok && new RegExp(`^shots/screencapture-127-0-0-1-\\d+-long-html\\.${fmt}$`).test(requested), `${requested} (${d?.size} bytes)`);
    if (fmt === 'pdf' && d) {
      const text = readFileSync(d.filename).toString('latin1');
      const count = Number(text.match(/\/Count (\d+)/)?.[1]);
      check('저장: A4 PDF는 여러 페이지 + 링크 포함', count >= 2 && text.includes('/URI (https://example.com/link)'), `페이지 ${count}`);
      writeFileSync(join(OUT, 'export.pdf'), readFileSync(d.filename));
    }
  }
  await page.locator('#copy-btn').click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('복사'));
  const toastText = await page.locator('.toast').textContent();
  check('복사: 클립보드 복사 결과 알림', toastText.includes('복사'), toastText);
  await page.close();
  await worker.evaluate(() => chrome.storage.local.remove('settings'));
}

/** 설정 화면: 바꾸면 바로 저장, 잘못된 폴더 이름은 안내, 크롬 단축키 표시 */
async function optionsFlow(context, worker, extId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.waitForSelector('#papers .paper');
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings ?? {});
  await page.locator('#file-format button[data-value="jpg"]').click();
  await page.waitForTimeout(200);
  check('설정: 파일 형식 JPEG 저장', (await stored()).fileFormat === 'jpg');
  await page.locator('#papers .paper').nth(3).click();
  await page.waitForTimeout(200);
  check('설정: PDF 용지 A4 저장', (await stored()).pdfPaper === 'a4');
  await page.locator('#save-folder').fill('..');
  await page.locator('#save-folder-btn').click();
  check('설정: 폴더 이름 ".." → 오류 안내, 저장 안 함', (await page.locator('#folder-error').isVisible()) && (await stored()).saveFolder === '');
  await page.locator('#save-folder').fill('  내 캡처  ');
  await page.locator('#save-folder-btn').click();
  await page.waitForTimeout(200);
  check('설정: 폴더 이름 저장(앞뒤 공백 제거)', (await stored()).saveFolder === '내 캡처', (await stored()).saveFolder);
  await page.locator('#scroll-delay').selectOption('300');
  await page.waitForTimeout(200);
  check('설정: 스크롤 사이 기다리기 300ms 저장', (await stored()).scrollDelayMs === 300);
  const sc = await page.locator('#shortcut-current').textContent();
  check('설정: 크롬 단축키 표시', /Alt\+Shift\+K|⌥⇧K/.test(sc), sc);
  await page.screenshot({ path: join(OUT, 'options.png'), fullPage: true });
  await page.close();
  await worker.evaluate(() => chrome.storage.local.remove('settings'));
}

/** 바로 파일로 내려받기(SET-15): 결과 탭 없이 파일이 저장된다 */
async function autoDownloadFlow(context, worker, extId, origin) {
  await worker.evaluate(() => chrome.storage.local.set({ settings: { autoDownload: true, fileFormat: 'png' } }));
  const page = context.pages()[0];
  await page.goto(origin + '/dark.html');
  await page.bringToFront();
  const before = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  const tab = await worker.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url });
    return { id: t.id, windowId: t.windowId };
  }, origin + '/dark.html');
  const driverPromise = context.waitForEvent('page');
  await worker.evaluate((url) => chrome.windows.create({ url, focused: false }), `chrome-extension://${extId}/result.html?id=driver`);
  const driver = await driverPromise;
  await driver.waitForLoadState();
  let resultOpened = false;
  const onPage = (p) => {
    if (p.url().includes('result.html?id=') && !p.url().includes('driver')) resultOpened = true;
  };
  context.on('page', onPage);
  const last = await driver.evaluate(
    (tab) =>
      new Promise((done) => {
        const port = chrome.runtime.connect({ name: 'capture-popup' });
        port.onMessage.addListener((m) => (m.kind === 'done' || m.kind === 'error') && done(m));
        port.postMessage({ kind: 'open', tabId: tab.id, windowId: tab.windowId });
      }),
    tab,
  );
  await driver.waitForTimeout(1500);
  context.off('page', onPage);
  const after = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  check('자동 내려받기: 완료 메시지(autoDownloaded) + 파일 1개 + 결과 탭 안 열림', last.autoDownloaded === true && after === before + 1 && !resultOpened, JSON.stringify(last));
  await driver.close();
  await worker.evaluate(() => chrome.storage.local.remove('settings'));
}

/** 내 스크린샷: 개수, 검색, 전체 선택, 모두 저장(파일 하나씩), 선택 삭제 */
async function galleryFlow(context, worker, extId) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`chrome-extension://${extId}/gallery.html`);
  await page.waitForSelector('.card');
  const cards = await page.locator('.card').count();
  const countText = await page.locator('#count').textContent();
  check('내 스크린샷: 보관 개수 표시 = 카드 수', countText === `이 기기에 보관: ${cards}` && cards >= 4, countText);
  const firstTitle = await page.locator('.card .name').first().textContent();
  check('내 스크린샷: 최신 촬영이 맨 앞(자동 내려받기로 찍은 어두운 페이지)', firstTitle === '어두운 페이지', firstTitle);
  await page.locator('#search').fill('내부');
  check('내 스크린샷: 검색 "내부" → 1개', (await page.locator('.card').count()) === 1);
  await page.locator('#search').fill('');
  await page.locator('.card').first().hover();
  await page.screenshot({ path: join(OUT, 'gallery.png') });

  await page.locator('#select-all').click();
  const sel = await page.locator('#selected-count').textContent();
  check('내 스크린샷: 전체 선택 → "선택됨: N", 버튼은 "전체 선택 해제"', sel === `선택됨: ${cards}` && (await page.locator('#select-all').textContent()) === '전체 선택 해제', sel);
  await page.screenshot({ path: join(OUT, 'gallery-select.png') });
  const before = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  await page.locator('#save-selected').click();
  await page.waitForFunction(() => document.querySelector('.toast')?.classList.contains('show'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const after = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  check('내 스크린샷: 모두 저장 → 파일이 하나씩 따로 저장', after - before === cards, `${after - before}개`);

  // 하나만 남기고 해제한 뒤 지우기
  await page.locator('#select-all').click(); // 해제(선택 모드 끝)
  await page.locator('#select-all').click(); // 다시 전체 선택
  for (let k = 1; k < cards; k++) await page.locator('.card').nth(k).click();
  check('내 스크린샷: 카드 눌러 빼기 → 선택됨: 1', (await page.locator('#selected-count').textContent()) === '선택됨: 1');
  await page.locator('#delete-selected').click();
  await page.waitForFunction((n) => document.querySelectorAll('.card').length === n, cards - 1);
  check('내 스크린샷: 선택 삭제 → 1개 줄어듦', (await page.locator('#count').textContent()) === `이 기기에 보관: ${cards - 1}`);
  await page.close();
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
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--window-size=1000,800',
      `--force-device-scale-factor=${process.env.DPR || 1}`,
    ],
  });

  try {
    const isOurs = (w) => w.url().endsWith('/background.js');
    let worker = context.serviceWorkers().find(isOurs);
    if (!worker) worker = await context.waitForEvent('serviceworker', { predicate: isOurs });
    // 막 시작한 서비스 워커는 chrome.* API가 붙기 전일 수 있어 준비될 때까지 기다린다
    for (let k = 0; k < 50 && !(await worker.evaluate(() => typeof chrome?.tabs?.query === 'function')); k++) await new Promise((r) => setTimeout(r, 100));
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
    await exportFlow(context, worker, extId, shotIds['/long.html']);
    await optionsFlow(context, worker, extId);
    await autoDownloadFlow(context, worker, extId, origin);
    await galleryFlow(context, worker, extId);

    // 보호 페이지 안내 (CAP-11): 확장 페이지 자신은 찍을 수 없는 주소이므로 안내가 나와야 한다
    const pop = await context.newPage();
    await pop.setViewportSize({ width: 380, height: 360 }).catch(() => undefined);
    await pop.goto(`chrome-extension://${extId}/popup.html`);
    await pop.waitForSelector('#blocked-view:not([hidden])');
    check('팝업: 보호 페이지에서는 촬영하지 않고 안내', await pop.locator('#blocked-view h1').isVisible(), await pop.locator('#blocked-view h1').textContent());
    await pop.screenshot({ path: join(OUT, 'popup-blocked.png') });
    await pop.close();

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
