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

/** 촬영 도중 멈춤과 다시 시작: 멈춘 동안 페이지는 원래 모양, 다시 시작하면 끝까지 바르게 찍힌다 (CAP-04) */
async function pauseFlow(context, worker, extId, origin) {
  const page = context.pages()[0];
  await page.goto(origin + '/long.html');
  await page.bringToFront();
  const tab = await worker.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url });
    return { id: t.id, windowId: t.windowId };
  }, origin + '/long.html');
  const driverPromise = context.waitForEvent('page');
  await worker.evaluate((url) => chrome.windows.create({ url, focused: false }), `chrome-extension://${extId}/result.html?id=driver`);
  const driver = await driverPromise;
  await driver.waitForLoadState();
  const resultPromise = context.waitForEvent('page', { predicate: (p) => p.url().includes('result.html?id=') && !p.url().includes('driver') });
  await driver.evaluate((tab) => {
    window.__msgs = [];
    window.__port = chrome.runtime.connect({ name: 'capture-popup' });
    window.__port.onMessage.addListener((m) => window.__msgs.push(m));
    window.__port.postMessage({ kind: 'open', tabId: tab.id, windowId: tab.windowId });
  }, tab);
  await driver.waitForFunction(() => window.__msgs.some((m) => m.kind === 'progress' && m.current >= 2));
  await driver.evaluate(() => window.__port.postMessage({ kind: 'togglePause' }));
  await driver.waitForTimeout(1500);
  const pausedState = await driver.evaluate(() => {
    const p = window.__msgs.filter((m) => m.kind === 'progress');
    return { paused: p.at(-1).paused, current: p.at(-1).current };
  });
  const styleGone = await page.evaluate(() => !document.getElementById('__hanjang-capture-style'));
  await driver.waitForTimeout(1200);
  const still = await driver.evaluate(() => window.__msgs.filter((m) => m.kind === 'progress').at(-1).current);
  check('멈춤: 진행이 멈추고 페이지 모양이 원래대로(스크롤 막대 숨김 해제)', pausedState.paused && styleGone && still === pausedState.current, JSON.stringify(pausedState));
  await driver.evaluate(() => window.__port.postMessage({ kind: 'togglePause' }));
  const result = await resultPromise;
  await result.waitForSelector('#preview[src^="blob:"]');
  const ok = await result.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('id');
    const db = await new Promise((r) => { const q = indexedDB.open('hanjang-capture'); q.onsuccess = () => r(q.result); });
    const shot = await new Promise((r) => { const q = db.transaction('shots').objectStore('shots').get(id); q.onsuccess = () => r(q.result); });
    const bmp = await createImageBitmap(shot.image);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const bottom = ctx.getImageData(bmp.width / 2, bmp.height - 5, 1, 1).data;
    // 오른쪽 끝(스크롤 막대 자리)이 바탕과 같은 색인지: 막대가 찍혔으면 회색 띠가 남는다
    const right = ctx.getImageData(bmp.width - 3, Math.floor(bmp.height / 2), 1, 1).data;
    const mid = ctx.getImageData(bmp.width / 2, Math.floor(bmp.height / 2), 1, 1).data;
    return { h: bmp.height, bottom: Array.from(bottom.slice(0, 3)), sameRight: right.slice(0, 3).every((v, i) => Math.abs(v - mid[i]) < 30) };
  });
  check('멈춤: 다시 시작 → 끝까지 찍히고 스크롤 막대가 찍히지 않음', ok.h >= 3560 && ok.bottom.some((v) => v < 245) && ok.sameRight, JSON.stringify(ok));
  await result.close();
  await driver.close();
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
  check('편집기: 도구 막대에 붓이 없음(11개 도구)', (await ed.locator('#toolbar [data-tool]').count()) === 11 && (await ed.locator('#toolbar [data-tool="brush"]').count()) === 0);
  await dragBy('r', at(0.2, 0.2), at(0.45, 0.35));
  await dragBy('a', at(0.5, 0.5), at(0.7, 0.3));
  await dragBy('o', at(0.2, 0.5), at(0.35, 0.65));
  await dragBy('l', at(0.1, 0.8), at(0.4, 0.85));
  await dragBy('b', at(0.55, 0.6), at(0.75, 0.75));
  await dragBy('h', at(0.1, 0.1), at(0.3, 0.12));
  await dragBy('p', at(0.6, 0.15), at(0.8, 0.25));
  await dragBy('p', at(0.6, 0.25), at(0.8, 0.35)); // 붓은 없앴으므로 펜으로 한 번 더
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

  // Shift + 사각형 → 정사각형, 그 뒤 Esc → 선택 도구
  {
    await ed.keyboard.press('r');
    const [sx0, sy0] = at(0.3, 0.55);
    await ed.mouse.move(sx0, sy0);
    await ed.mouse.down();
    await ed.keyboard.down('Shift');
    await ed.mouse.move(sx0 + 150, sy0 + 60, { steps: 4 });
    await ed.mouse.up();
    await ed.keyboard.up('Shift');
    await ed.keyboard.press('Escape');
    check('편집기: 그리기 도구에서 Esc → 선택 도구', (await ed.locator('#toolbar [data-tool="select"].active').count()) === 1);
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  }

  // 펜 선 보정 (PR #1 세 번째·네 번째 요청, 설정 기본 켜짐)
  // - 손떨림처럼 잘게 흔들린 선은 손을 뗄 때 다듬어진다
  // - 일부러 뾰족하게 꺾은 곳(V자 꼭짓점)은 그대로 남는다
  {
    const lastPoints = () =>
      ed.evaluate(async (id) => {
        const db = await new Promise((r) => { const q = indexedDB.open('hanjang-capture'); q.onsuccess = () => r(q.result); });
        const shot = await new Promise((r) => { const q = db.transaction('shots').objectStore('shots').get(id); q.onsuccess = () => r(q.result); });
        return shot.doc.objects.at(-1).points;
      }, id);
    const z = parseFloat(await ed.locator('#zoom-label').textContent()) / 100;
    const drawPen = async (pts) => {
      await ed.keyboard.press('p');
      await ed.mouse.move(...pts[0]);
      await ed.mouse.down();
      for (const p of pts.slice(1)) await ed.mouse.move(...p);
      await ed.mouse.up();
      await ed.waitForTimeout(1500);
    };
    const [zx, zy] = at(0.3, 0.45);
    await drawPen([[zx, zy], ...Array.from({ length: 40 }, (_, k) => [zx + (k + 1) * 3, zy + (k % 2 ? 2 : -2)]), [zx + 123, zy]]);
    const ys = (await lastPoints()).filter((_, i) => i % 2 === 1).slice(4, -4);
    const mid = (Math.max(...ys) + Math.min(...ys)) / 2;
    const dev = Math.max(...ys.map((y) => Math.abs(y - mid)));
    check('편집기: 펜 손떨림(±2px) → 손을 떼면 흔들림이 절반 이하로 다듬어짐', dev <= 2 / z / 2, `흔들림 ${dev.toFixed(2)}px (원래 ${(2 / z).toFixed(2)}px)`);
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');

    const [vx, vy] = at(0.3, 0.4);
    await drawPen([[vx, vy], ...Array.from({ length: 20 }, (_, k) => [vx + (k + 1) * 3, vy + (k + 1) * 4]), ...Array.from({ length: 20 }, (_, k) => [vx + 60 + (k + 1) * 3, vy + 80 - (k + 1) * 4])]);
    const vp = await lastPoints();
    const vys = vp.filter((_, i) => i % 2 === 1);
    // 꼭짓점이 깎이면 가장 아래 점이 올라와 V자 깊이가 얕아진다
    const tipY = Math.max(...vys);
    check('편집기: 펜으로 일부러 뾰족하게 꺾은 V자 → 꼭짓점이 깎이지 않음', tipY - Math.min(...vys) >= 80 / z - 2, `꼭짓점 깊이 ${(tipY - Math.min(...vys)).toFixed(1)}px (원래 ${(80 / z).toFixed(1)}px)`);
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  }

  // Shift로 목록에서 두 개 고르기 → 함께 지우기 → 실행 취소
  {
    const n0 = await ed.locator('#objects-list li').count();
    await ed.locator('#objects-list li').nth(0).click();
    await ed.locator('#objects-list li').nth(1).click({ modifiers: ['Shift'] });
    const selCount = await ed.locator('#objects-list li.selected').count();
    const panelTitle = await ed.locator('#style-panel h3').textContent();
    await ed.keyboard.press('Delete');
    const n1 = await ed.locator('#objects-list li').count();
    await ed.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    const n2 = await ed.locator('#objects-list li').count();
    check('편집기: Shift로 두 개 선택 → 함께 지우기 → 실행 취소로 복구', selCount === 2 && panelTitle === '개체 2개 선택됨' && n1 === n0 - 2 && n2 === n0, `${selCount}, ${panelTitle}, ${n0}→${n1}→${n2}`);
    const head = await ed.locator('.objects-title').innerText();
    check('편집기: 개체 목록 머리글은 "개체"(왼쪽)와 개수(오른쪽)', /^개체\s+\d+$/.test(head.trim()), head);
    await ed.keyboard.press('Escape');
  }

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
  await ed.locator('#objects-list li', { hasText: '화살표' }).click();
  await ed.screenshot({ path: join(OUT, 'editor-arrow.png'), clip: { x: 1000, y: 40, width: 280, height: 320 } });
  await ed.keyboard.press('Escape');

  // 도장 켜기(U) → 결과 크기가 커진다
  const before = await status();
  await ed.keyboard.press('u');
  const after = await status();
  check('편집기: U로 주소·날짜 도장 켜기 → 결과 높이 증가', before !== after, `${before} → ${after}`);
  await ed.screenshot({ path: join(OUT, 'editor.png') });

  // 끄는 도중 Ctrl+Z는 무시되고, 손을 뗀 뒤 개체가 하나 늘어야 한다
  {
    const n0 = await ed.locator('#objects-list li').count();
    await ed.keyboard.press('r');
    const [x0, y0] = at(0.3, 0.4);
    await ed.mouse.move(x0, y0);
    await ed.mouse.down();
    await ed.mouse.move(x0 + 60, y0 + 40, { steps: 3 });
    await ed.keyboard.press('Control+z');
    await ed.mouse.move(x0 + 120, y0 + 80, { steps: 3 });
    await ed.mouse.up();
    const n1 = await ed.locator('#objects-list li').count();
    await ed.keyboard.press('Control+z');
    const n2 = await ed.locator('#objects-list li').count();
    check('편집기: 끄는 도중 Ctrl+Z 무시 → 손을 떼면 1개 늘고, 그 뒤 Ctrl+Z로 되돌아감', n1 === n0 + 1 && n2 === n0, `${n0} → ${n1} → ${n2}`);
    await ed.keyboard.press('Escape');
  }

  // 자르기: 도구 막대의 자르기 버튼 → 오른쪽 변 핸들을 안쪽으로 → Enter
  await ed.locator('#toolbar [data-tool="crop"]').click();
  await ed.waitForTimeout(200);
  await ed.screenshot({ path: join(OUT, 'editor-crop.png') });
  // 자르기 버튼은 그림 영역 아래 줄에 있어 그림을 가리지 않는다 (PR #1 두 번째 요청)
  const cropBarBox = await ed.locator('#crop-bar').boundingBox();
  const stageBox = await ed.locator('.stage-wrap').boundingBox();
  check('편집기: 자르기 버튼이 그림 영역과 겹치지 않음', !!cropBarBox && cropBarBox.y >= stageBox.y + stageBox.height - 0.5, JSON.stringify({ cropBarBox, stageBox }));
  // 자르기 화면은 전체 맞춤이라 이미지가 가운데에 있다 → 오른쪽 변 가운데 핸들을 왼쪽으로 끈다
  const vb = await ed.locator('#view').boundingBox();
  const z = parseFloat(await ed.locator('#zoom-label').textContent()) / 100;
  const imgW = Number((await status()).match(/^(\d+) x/)[1]);
  const ex = vb.x + vb.width / 2 + (imgW * z) / 2;
  const ey = vb.y + vb.height / 2;
  await ed.mouse.move(ex, ey);
  await ed.mouse.down();
  await ed.mouse.move(ex - 50, ey, { steps: 5 });
  await ed.mouse.up();
  await ed.keyboard.press('Enter');
  await ed.waitForTimeout(100);
  const cropped = await status();
  check('편집기: 자르기 적용 → 크기 줄어듦', cropped !== after, cropped);
  check('편집기: Enter로 적용한 뒤 자르기 모드에 다시 들어가지 않음', (await ed.locator('#crop-bar').isHidden()) && (await ed.locator('#toolbar [data-tool="select"].active').count()) === 1);
  await ed.keyboard.press('Shift+?');
  check('편집기: Shift+?로 단축키 창', await ed.locator('#shortcuts-dialog').isVisible());
  await ed.screenshot({ path: join(OUT, 'editor-shortcuts.png') });
  await ed.keyboard.press('Escape');

  // 모두 초기화 → 개체·자르기가 모두 사라지고, 되돌리기로 되살아남 (PR #1 두 번째 요청)
  const beforeReset = await status();
  await ed.locator('#reset-btn').click();
  await ed.waitForTimeout(100);
  const afterReset = await status();
  const resetDisabled = await ed.locator('#reset-btn').isDisabled();
  await ed.keyboard.press('Control+z');
  await ed.waitForTimeout(100);
  check(
    '편집기: 모두 초기화 → 개체 0개·원래 크기, 버튼 꺼짐, Ctrl+Z로 되살아남',
    /개체 0개|0개/.test(afterReset) && afterReset !== beforeReset && resetDisabled && (await status()) === beforeReset,
    `${beforeReset} → ${afterReset} → ${await status()}`,
  );

  // Ctrl+휠로 확대 (PR #1 두 번째 요청)
  const zBefore = await ed.locator('#zoom-label').textContent();
  const vb2 = await ed.locator('.stage-wrap').boundingBox();
  await ed.mouse.move(vb2.x + vb2.width / 2, vb2.y + vb2.height / 2);
  await ed.keyboard.down('Control');
  await ed.mouse.wheel(0, -200);
  await ed.keyboard.up('Control');
  await ed.waitForTimeout(150);
  const zAfter = await ed.locator('#zoom-label').textContent();
  check('편집기: Ctrl+휠 위로 → 확대', parseFloat(zAfter) > parseFloat(zBefore), `${zBefore} → ${zAfter}`);

  // 뒤로 → 결과 화면에 편집 내용 반영 (RES-08)
  await ed.locator('#back-btn').click();
  await ed.waitForURL(/result\.html/);
  await ed.waitForSelector('#preview[src^="blob:"]');
  await ed.waitForTimeout(500);
  const size = await ed.locator('#image-size').textContent();
  check('결과 화면: 편집(자르기) 반영된 크기', cropped.startsWith(size.replace(' px', '')), `${size} / ${cropped}`);
  await ed.screenshot({ path: join(OUT, 'result-edited.png') });

  // 결과 화면: Ctrl+휠 확대, 내 스크린샷·설정은 같은 탭에서 열림 (PR #1 두 번째 요청)
  const rz0 = await ed.locator('#zoom-label').textContent();
  const pv = await ed.locator('#viewport').boundingBox();
  await ed.mouse.move(pv.x + pv.width / 2, pv.y + pv.height / 2);
  await ed.keyboard.down('Control');
  await ed.mouse.wheel(0, 200);
  await ed.keyboard.up('Control');
  await ed.waitForTimeout(150);
  const rz1 = await ed.locator('#zoom-label').textContent();
  check('결과 화면: Ctrl+휠 아래로 → 축소', parseFloat(rz1) < parseFloat(rz0), `${rz0} → ${rz1}`);
  const pagesBefore = context.pages().length;
  await ed.locator('#gallery-btn').click();
  await ed.waitForURL(/gallery\.html/);
  await ed.goBack();
  await ed.waitForURL(/result\.html/);
  await ed.locator('#settings-btn').click();
  await ed.waitForURL(/options\.html/);
  check('결과 화면: 내 스크린샷·설정 버튼 → 새 탭 없이 같은 탭에서 바뀜', context.pages().length === pagesBefore, `${pagesBefore} → ${context.pages().length}`);
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
    if (fmt === 'pdf') {
      // PDF는 미리보기 창에서 나뉘는 곳을 보고 고친 뒤 저장한다 (PR #1 세 번째 요청)
      await page.waitForSelector('#pdf-preview .pdfp-card');
      const pages0 = await page.locator('#pdf-preview .pdfp-card').count();
      const lines0 = await page.locator('#pdf-preview .pdfp-break').count();
      check('PDF 미리보기: A4로 여러 쪽, 나뉘는 선 = 쪽 수 - 1', pages0 >= 2 && lines0 === pages0 - 1, `${pages0}쪽, 선 ${lines0}개`);
      await page.screenshot({ path: join(OUT, 'pdf-preview.png') });
      // 첫 번째 선을 위로 끌면 그 자리로 옮겨지고, 오른쪽 1쪽 그림 아래 여백이 생긴다
      const line = page.locator('#pdf-preview .pdfp-break').first();
      await line.scrollIntoViewIfNeeded();
      const lb = await line.boundingBox();
      const top0 = await line.evaluate((el) => parseFloat(el.style.top));
      await page.mouse.move(lb.x + 60, lb.y + lb.height / 2);
      await page.mouse.down();
      await page.mouse.move(lb.x + 60, lb.y - 80, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const top1 = await line.evaluate((el) => parseFloat(el.style.top));
      check('PDF 미리보기: 나뉘는 선을 위로 끌면 옮겨짐', Math.abs(top0 - 80 - top1) <= 2, `${top0} → ${top1}`);
      const mergeOk = await page.locator('#pdf-preview .pdfp-merge').first().isDisabled();
      check('PDF 미리보기: 합치면 한 쪽에 안 들어가는 선은 합치기 버튼이 꺼짐', mergeOk);
      await page.screenshot({ path: join(OUT, 'pdf-preview-moved.png') });
      // Esc로 취소하면 저장되지 않는다
      const before = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const after = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
      check('PDF 미리보기: Esc → 창이 닫히고 저장 안 됨', (await page.locator('#pdf-preview').count()) === 0 && after === before);
      await page.locator('#save-more').click();
      await page.locator('#save-menu button[data-format="pdf"]').click();
      await page.waitForSelector('#pdf-preview .pdfp-card');
      await page.locator('#pdfp-save').click();
    }
    const d = await waitDownload(fmt);
    // Playwright는 내려받은 파일을 임시 폴더에 다른 이름으로 두므로, 확장이 요청한 경로는 따로 기록해 본다
    const requested = await page.evaluate(() => window.__requested.at(-1));
    const ok = !!d && readFileSync(d.filename).subarray(0, 4).toString('hex').startsWith(magic[fmt]);
    check(`저장: ${fmt.toUpperCase()} 파일 내용이 맞고 shots 폴더로 요청됨`, ok && new RegExp(`^shots/screencapture-127-0-0-1-\\d+-long-html\\.${fmt}$`).test(requested), `${requested} (${d?.size} bytes)`);
    if (fmt === 'pdf' && d) {
      const text = readFileSync(d.filename).toString('latin1');
      const count = Number(text.match(/\/Count (\d+)/)?.[1]);
      check('저장: A4 PDF는 여러 페이지 + 링크 포함', count >= 2 && text.includes('/URI (https://example.com/link)'), `페이지 ${count}`);
      // 마지막 쪽은 그림이 짧아 남는 여백을 그림 바탕색(마지막 구역 색, 흰색 아님)으로 채운다
      const fills = [...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f/g)].map((m) => m.slice(1, 4).map(Number));
      const last = fills.at(-1);
      check('저장: PDF 남는 여백을 그림 바탕색으로 채움', !!last && !(last[0] > 0.95 && last[1] > 0.95 && last[2] > 0.95), JSON.stringify(last));
      writeFileSync(join(OUT, 'export.pdf'), readFileSync(d.filename));
    }
  }
  // 설정에서 미리보기를 끄면 창 없이 바로 저장된다 (Q47 답변 ②)
  await worker.evaluate(() =>
    chrome.storage.local.set({ settings: { saveFolder: 'shots', pdfPaper: 'a4', pdfHeader: true, pdfLinks: true, pdfSmartBreak: true, pdfPreview: false } }),
  );
  const pdfBefore = await worker.evaluate(async () => (await chrome.downloads.search({ mime: 'application/pdf' })).length);
  await page.locator('#save-more').click();
  await page.locator('#save-menu button[data-format="pdf"]').click();
  let pdfAfter = pdfBefore;
  for (let k = 0; k < 50 && pdfAfter === pdfBefore; k++) {
    await page.waitForTimeout(200);
    pdfAfter = await worker.evaluate(async () => (await chrome.downloads.search({ mime: 'application/pdf' })).length);
  }
  check('저장: 미리보기를 끄면 창 없이 바로 PDF 저장', pdfAfter === pdfBefore + 1 && (await page.locator('#pdf-preview').count()) === 0, `${pdfBefore} → ${pdfAfter}`);

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
  const sc = (await page.locator('#shortcut-list').innerText()).replace(/\s+/g, ' ');
  check('설정: 단축키 3가지 표시(전체 Ctrl+Shift+K, 일부 Ctrl+Shift+E)', /페이지 전체 찍기 Ctrl\+Shift\+K/.test(sc) && /페이지 일부 찍기 Ctrl\+Shift\+E/.test(sc) && /도구 창 열기/.test(sc), sc);
  await page.locator('#papers .paper').nth(0).click();
  await page.waitForTimeout(150);
  check('설정: 전체 이미지 용지에서는 방향 선택이 꺼짐', await page.locator('#orientation button').first().isDisabled());
  await page.locator('#papers .paper').nth(3).click();
  await page.locator('#orientation button[data-value="landscape"]').click();
  await page.waitForTimeout(150);
  check('설정: A4 + 가로 방향 저장', (await stored()).pdfOrientation === 'landscape');
  const smoothDefault = await page.locator('#smooth-strokes').isChecked();
  await page.locator('#smooth-strokes').click();
  await page.waitForTimeout(200);
  check('설정: 펜 선 부드럽게 보정은 처음에 켜짐, 끄면 저장됨', smoothDefault && (await stored()).smoothStrokes === false);
  const previewDefault = await page.locator('#pdf-preview').isChecked();
  await page.locator('#pdf-preview').click();
  await page.waitForTimeout(200);
  check('설정: PDF 저장 전에 미리보기는 처음에 켜짐, 끄면 저장됨', previewDefault && (await stored()).pdfPreview === false);
  await page.locator('#pdf-preview').click();
  await page.waitForTimeout(200);
  await page.locator('#smooth-strokes').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, 'options.png'), fullPage: true });
  await page.close();
  await worker.evaluate(() => chrome.storage.local.remove('settings'));
}

/** 바로 파일로 내려받기(SET-15): 결과 탭 없이 파일이 저장된다 */
async function autoDownloadFlow(context, worker, extId, origin, path = '/dark.html') {
  await worker.evaluate(() => chrome.storage.local.set({ settings: { autoDownload: true, fileFormat: 'png' } }));
  const page = context.pages()[0];
  await page.goto(origin + path);
  await page.bringToFront();
  const before = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  const tab = await worker.evaluate(async (url) => {
    const [t] = await chrome.tabs.query({ url });
    return { id: t.id, windowId: t.windowId };
  }, origin + path);
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
  const items = await worker.evaluate(async () => (await chrome.downloads.search({ orderBy: ['-startTime'] })).map((d) => ({ state: d.state, size: d.fileSize, error: d.error })));
  // 아주 긴 페이지는 여러 장으로 나뉘어(CAP-08) 장마다 파일이 하나씩 생긴다
  const parts = await driver.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('hanjang-capture'); q.onsuccess = () => r(q.result); });
    const all = await new Promise((r) => { const q = db.transaction('shots').objectStore('shots').getAll(); q.onsuccess = () => r(q.result); });
    return all.sort((a, b) => b.createdAt - a.createdAt)[0].partCount;
  });
  const fresh = items.slice(0, items.length - before);
  check(`자동 내려받기(${path}): 완료 메시지 + 장마다 파일 1개(${parts}장) + 결과 탭 안 열림`, last.autoDownloaded === true && fresh.length === parts && fresh.every((d) => d.state === 'complete') && !resultOpened, `${JSON.stringify(last)} ${JSON.stringify(fresh)}`);
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
  check('내 스크린샷: 보관 개수 표시 = 카드 수', countText === `이 기기에 보관됨: ${cards}` && cards >= 5, countText);
  const firstTitle = await page.locator('.card .name').first().textContent();
  check('내 스크린샷: 최신 촬영이 맨 앞(마지막으로 찍은 큰 파일 페이지)', firstTitle.startsWith('큰 파일 페이지'), firstTitle);
  await page.locator('#search').fill('내부');
  check('내 스크린샷: 검색 "내부" → 1개', (await page.locator('.card').count()) === 1);
  await page.locator('#search').fill('');
  await page.locator('.card').first().hover();
  await page.screenshot({ path: join(OUT, 'gallery.png') });

  // 카드를 누르면 창이 열리지 않고 고르기만 된다. 크게 보기는 마우스를 올려 나오는 "전체 보기"로만 (PR #1 다섯 번째 요청)
  const pagesBefore = context.pages().length;
  await page.locator('.card .thumb').first().click();
  await page.waitForTimeout(500);
  const picked = await page.locator('#selected-count').textContent();
  check('내 스크린샷: 카드를 누르면 새 창 없이 선택됨: 1', context.pages().length === pagesBefore && picked === '선택됨: 1' && (await page.locator('.card.selected').count()) === 1, `${picked}, 탭 ${pagesBefore} → ${context.pages().length}`);
  await page.locator('.card .thumb').first().click();
  check('내 스크린샷: 다시 누르면 선택이 풀리고 선택 막대가 사라짐', (await page.locator('.card.selected').count()) === 0 && (await page.locator('#select-bar').isHidden()));
  await page.locator('.card').first().hover();
  const viewBtn = page.locator('.card').first().locator('.hover-icons button').first();
  const viewTitle = await viewBtn.getAttribute('title');
  const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('result.html?id='), timeout: 10000 });
  await viewBtn.click();
  const viewPage = await opened.catch(() => null);
  check('내 스크린샷: 마우스를 올려 나오는 "전체 보기" → 결과 화면이 열림', viewTitle === '전체 보기' && !!viewPage, viewTitle);
  if (viewPage) await viewPage.close();

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
  check('내 스크린샷: 선택 삭제 → 1개 줄어듦', (await page.locator('#count').textContent()) === `이 기기에 보관됨: ${cards - 1}`);
  await page.close();
}

/** 열린 툴바 팝업에 CDP로 붙어 안에서 스크립트를 실행한다 (Playwright가 팝업을 페이지로 주지 않아서) */
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

async function shotSize(page) {
  return page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('id');
    const db = await new Promise((r) => {
      const q = indexedDB.open('hanjang-capture');
      q.onsuccess = () => r(q.result);
    });
    const shot = await new Promise((r) => {
      const q = db.transaction('shots').objectStore('shots').get(id);
      q.onsuccess = () => r(q.result);
    });
    return { w: shot.width, h: shot.height };
  });
}

/** 툴바 팝업: 고르는 창, 페이지 전체, 페이지 일부(마우스로 영역 끌기) (PR #1 요청) */
async function popupFlow(context, worker, origin) {
  const page = context.pages()[0];
  await page.goto(origin + '/long.html');
  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  let pop = await attachPopup(context, page);
  await new Promise((r) => setTimeout(r, 300));
  const visible = await pop.eval(`[...document.querySelectorAll('section')].filter((s) => !s.hidden).map((s) => s.id).join(',')`);
  const keys = await pop.eval(`document.getElementById('key-full').textContent + ' / ' + document.getElementById('key-area').textContent`);
  check('팝업: 아이콘을 누르면 "무엇을 찍을까요?" 고르는 창 + 단축키 표시', visible === 'choose-view' && keys === 'Ctrl+Shift+K / Ctrl+Shift+E', `${visible} ${keys}`);
  await pop.screenshot(join(OUT, 'popup-choose.png'));

  let resultPromise = context.waitForEvent('page', { predicate: (p) => p.url().includes('result.html?id='), timeout: 60000 });
  await pop.eval(`document.getElementById('choose-full').click()`);
  let result = await resultPromise.catch(() => null);
  check('팝업: "페이지 전체" → 촬영 후 결과 탭', !!result && (await shotSize(result)).h >= 3560);
  if (result) await result.close();

  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  pop = await attachPopup(context, page);
  await new Promise((r) => setTimeout(r, 300));
  await pop.eval(`document.getElementById('choose-area').click()`);
  await page.waitForFunction(() => !!document.getElementById('__hanjang-area'), null, { timeout: 5000 });
  const dpr = await page.evaluate(() => devicePixelRatio);
  resultPromise = context.waitForEvent('page', { predicate: (p) => p.url().includes('result.html?id='), timeout: 30000 });
  await page.mouse.move(100, 120);
  await page.mouse.down();
  await page.mouse.move(250, 200, { steps: 4 });
  await page.mouse.move(400, 320, { steps: 4 });
  await page.mouse.up();
  result = await resultPromise.catch(() => null);
  const size = result ? await shotSize(result) : null;
  check('팝업: "페이지 일부" → 끈 영역(300x200)만 찍힘', !!size && size.w === 300 * dpr && size.h === 200 * dpr, JSON.stringify(size));
  const overlayGone = await page.evaluate(() => !document.getElementById('__hanjang-area'));
  check('팝업: 영역을 고른 뒤 덮개가 사라짐', overlayGone);
  if (result) {
    await result.screenshot({ path: join(OUT, 'result-area.png') });
    await result.close();
  }

  // 끄는 중 화면 아래 끝에 머물면 자동 스크롤되고, 화면보다 긴 영역이 이어 붙여 찍힌다 (Q43 답변 ②)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  pop = await attachPopup(context, page);
  await new Promise((r) => setTimeout(r, 300));
  await pop.eval(`document.getElementById('choose-area').click()`);
  await page.waitForFunction(() => !!document.getElementById('__hanjang-area'), null, { timeout: 5000 });
  const vh = await page.evaluate(() => innerHeight);
  resultPromise = context.waitForEvent('page', { predicate: (p) => p.url().includes('result.html?id='), timeout: 60000 });
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(400, vh - 5, { steps: 6 });
  await new Promise((r) => setTimeout(r, 1200));
  const scrolled = await page.evaluate(() => scrollY);
  await page.mouse.up();
  result = await resultPromise.catch(() => null);
  const tall = result ? await shotSize(result) : null;
  check('영역 고르기: 아래 끝에 머물면 자동 스크롤', scrolled > 0, `scrollY=${scrolled}`);
  check(
    '영역 고르기: 화면보다 긴 영역 → 스크롤하며 이어 붙여 찍음',
    !!tall && tall.w === 300 * dpr && tall.h >= (vh - 5 + scrolled - 200) * dpr - 2 && tall.h > vh * dpr,
    JSON.stringify({ tall, vh, scrolled }),
  );
  if (result) {
    await result.screenshot({ path: join(OUT, 'result-area-tall.png') });
    await result.close();
  }

  // 부드러운 스크롤 페이지, 페이지 안 스크롤 상자에서도 자동 스크롤되어 긴 영역이 찍힌다 (PR #1 세 번째 요청: 실제 사이트에서 안 됨)
  for (const [path, edgeY, label] of [
    ['/smooth.html', (vh) => vh - 5, '부드러운 스크롤 페이지'],
    ['/inner.html', (vh) => vh - 45, '페이지 안 스크롤 상자'],
    ['/framed.html', (vh) => vh - 5, '틀(iframe) 안 본문 (Issue #3)'],
  ]) {
    await page.goto(origin + path);
    await page.bringToFront();
    await worker.evaluate(() => chrome.action.openPopup());
    pop = await attachPopup(context, page);
    await new Promise((r) => setTimeout(r, 300));
    await pop.eval(`document.getElementById('choose-area').click()`);
    await page.waitForFunction(() => !!document.getElementById('__hanjang-area'), null, { timeout: 5000 });
    const h = await page.evaluate(() => innerHeight);
    resultPromise = context.waitForEvent('page', { predicate: (p) => p.url().includes('result.html?id='), timeout: 60000 });
    await page.mouse.move(100, 150);
    await page.mouse.down();
    await page.mouse.move(400, edgeY(h), { steps: 6 });
    await new Promise((r) => setTimeout(r, 1200));
    const moved = await page.evaluate(() => Math.max(scrollY, document.querySelector('.scroller')?.scrollTop ?? 0, document.getElementById('mainFrame')?.contentWindow.scrollY ?? 0));
    await page.mouse.up();
    result = await resultPromise.catch(() => null);
    const got = result ? await shotSize(result) : null;
    check(`영역 고르기(${label}): 끝에서 자동 스크롤 → 화면보다 긴 영역이 찍힘`, moved > 300 && !!got && got.w === 300 * dpr && got.h >= (edgeY(h) - 150 + moved) * dpr - 2, JSON.stringify({ moved, got }));
    if (result) {
      await result.screenshot({ path: join(OUT, `result-area-${path.slice(1, -5)}.png`) });
      await result.close();
    }
  }
  await page.goto(origin + '/long.html');

  // Esc로 영역 고르기 취소
  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  pop = await attachPopup(context, page);
  await new Promise((r) => setTimeout(r, 300));
  await pop.eval(`document.getElementById('choose-area').click()`);
  await page.waitForFunction(() => !!document.getElementById('__hanjang-area'), null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  check('팝업: 영역 고르기에서 Esc → 취소(덮개 사라짐)', await page.evaluate(() => !document.getElementById('__hanjang-area')));
}

/** 일괄 촬영 (SET-32, PR #1 요청): 주소 목록을 차례로 열어 찍고 내 스크린샷에 보관 */
async function batchFlow(context, worker, extId, origin) {
  const countShots = async (p) =>
    p.evaluate(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open('hanjang-capture');
        q.onsuccess = () => r(q.result);
      });
      return new Promise((r) => {
        const q = db.transaction('shots').objectStore('shots').count();
        q.onsuccess = () => r(q.result);
      });
    });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/batch.html`);
  await page.waitForSelector('#start-btn');
  const before = await countShots(page);
  await page.locator('#add-tabs').click();
  await page.waitForTimeout(300);
  const added = await page.locator('#urls').inputValue();
  check('일괄 촬영: "열린 탭 추가" → 열린 웹 페이지 주소가 들어감', added.includes(origin), added.split('\n')[0]);
  await page.locator('#urls').fill([`${origin}/long.html`, `${origin}/dark.html`, 'chrome://settings', `${origin}/bodyscroll.html`].join('\n'));
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => /끝났어요|그만뒀어요/.test(document.getElementById('progress-text')?.textContent ?? ''), null, { timeout: 120000 });
  const text = await page.locator('#progress-text').textContent();
  const note = await page.locator('#message').textContent();
  const after = await countShots(page);
  check('일괄 촬영: 주소 3개 성공, 찍을 수 없는 줄 1개는 건너뜀', text === '끝났어요. 성공 3개' && after - before === 3 && note.includes('1개'), `${text} / ${note} / +${after - before}`);
  await page.screenshot({ path: join(OUT, 'batch.png'), fullPage: true });

  // "파일 자동 다운로드"가 켜져 있으면 일괄 촬영 결과도 파일로 내려받는다 (Q44 답변 ②)
  await worker.evaluate(() => chrome.storage.local.set({ settings: { autoDownload: true, fileFormat: 'png' } }));
  const dlBefore = await worker.evaluate(async () => (await chrome.downloads.search({})).length);
  await page.locator('#urls').fill(`${origin}/dark.html`);
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => !/끝났어요/.test(document.getElementById('progress-text')?.textContent ?? ''), null, { timeout: 10000 });
  await page.waitForFunction(() => /끝났어요|그만뒀어요/.test(document.getElementById('progress-text')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const dl = await worker.evaluate(async () => (await chrome.downloads.search({ orderBy: ['-startTime'] })).map((d) => d.state));
  check('일괄 촬영: 자동 다운로드 켜짐 → 파일로도 내려받음', dl.length - dlBefore === 1 && dl[0] === 'complete', `${dl.length - dlBefore} ${dl[0]}`);
  await worker.evaluate(() => chrome.storage.local.remove('settings'));
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
      ['본문이 스크롤되는 페이지', '/bodyscroll.html', { minH: 3000, pixels: [[-5, 'not-white', '맨 아래 블록까지 찍힘']] }],
      ['틀(iframe) 안 본문 (Issue #3)', '/framed.html', { minH: 4000, pixels: [[5, 'not-white', '위쪽 초록 띠'], [-5, 'dark', '틀 안 본문 맨 아래 검은 띠까지 찍힘']] }],
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

    await pauseFlow(context, worker, extId, origin);
    await editorFlow(context, extId, shotIds['/long.html']);
    await exportFlow(context, worker, extId, shotIds['/long.html']);
    await optionsFlow(context, worker, extId);
    await autoDownloadFlow(context, worker, extId, origin);
    await autoDownloadFlow(context, worker, extId, origin, '/noise.html');
    await galleryFlow(context, worker, extId);

    // 실제 툴바 팝업 (CAP-01, PR #1): 고르는 창 → 페이지 전체 / 페이지 일부
    await popupFlow(context, worker, origin);
    await batchFlow(context, worker, extId, origin);

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
