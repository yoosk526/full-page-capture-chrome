// "페이지 일부" 촬영 (PR #1 요청): 영역 고르기 화면을 넣고, 고른 영역만 찍어 보관한다.
// 고른 영역이 화면보다 길면(끄는 동안 자동 스크롤, Q43 답변 ②) 스크롤하며 여러 번 찍어 이어 붙인다.
import { AREA_MIN_CSS, areaChunk, areaScrollTarget } from '../core/area';
import { MAX_PART_AREA, MAX_PART_HEIGHT, toDeviceSpan } from '../core/capturePlan';
import { normalizeRect } from '../core/crop';
import { emptyDoc } from '../core/doc';
import { delayBeforeNextCall } from '../core/throttle';
import { newId, putShot } from '../shared/db';
import type { AreaSelected, ContentRequest, PageMetrics } from '../shared/messages';
import { loadSettings } from '../shared/settingsStore';
import type { ShotRecord } from '../shared/types';
import { autoDownloadShots } from './autoDownload';
import { makeThumb } from './stitcher';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** 스크롤한 뒤 화면이 자리 잡을 때까지 기다리는 시간. TODO(추정) */
const AREA_SETTLE_MS = 150;

async function send<T>(tabId: number, req: ContentRequest): Promise<T> {
  const res = (await chrome.tabs.sendMessage(tabId, req)) as { ok: boolean; value?: T; error?: string } | undefined;
  if (!res) throw new Error('no response from page');
  if (!res.ok) throw new Error(res.error);
  return res.value as T;
}

export async function startAreaSelect(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['area.js'] });
}

/** 고른 영역을 찍어 보관한 뒤 결과 화면을 연다 */
export async function captureArea(tab: chrome.tabs.Tab, msg: AreaSelected): Promise<ShotRecord> {
  const tabId = tab.id!;
  const settings = await loadSettings();
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const m = await send<PageMetrics>(tabId, { kind: 'prepare', area: true });
  try {
    const r = normalizeRect(msg.rect);
    const x0 = Math.max(0, r.x);
    const x1 = Math.min(m.viewportWidth, r.x + r.w);
    const top = Math.max(0, r.y);
    let bottom = Math.min(Math.max(m.contentHeight, m.viewportHeight), r.y + r.h);
    if (x1 - x0 < AREA_MIN_CSS || bottom - top < AREA_MIN_CSS) throw new Error('area too small');

    let canvas: OffscreenCanvas | null = null;
    let scale = 1;
    let vh = m.viewportHeight;
    let covered = top;
    let current = m.scrollY;
    let lastCaptureAt: number | null = null;
    for (let i = 0; covered < bottom; i++) {
      const maxScroll = Math.max(0, m.contentHeight - vh);
      const want = areaScrollTarget(covered, bottom, current, vh, maxScroll);
      // 고를 때 보던 화면 그대로 찍는 첫 조각만 고정 머리글 등을 남기고, 스크롤해서 찍는 조각에서는 숨긴다 (CAP-06)
      const index = i === 0 && want === m.scrollY ? 0 : 1;
      const actual = await send<number>(tabId, { kind: 'scrollTo', y: want, index });
      if (actual !== current) await sleep(AREA_SETTLE_MS);
      current = actual;
      await sleep(delayBeforeNextCall(lastCaptureAt, Date.now()));
      lastCaptureAt = Date.now();
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      try {
        if (!canvas) {
          scale = bitmap.width / m.viewportWidth;
          // 기기 흉내 모드 등으로 찍힌 높이가 화면 높이보다 짧을 수 있다
          vh = Math.min(vh, bitmap.height / scale);
          // 캔버스 한계를 넘지 않게 아래쪽을 줄인다. TODO(추정): 넘는 부분은 찍지 않는다
          const wPx = Math.round((x1 - x0) * scale);
          const maxH = Math.min(MAX_PART_HEIGHT, Math.floor(MAX_PART_AREA / wPx)) / scale;
          bottom = Math.min(bottom, top + Math.floor(maxH));
          canvas = new OffscreenCanvas(wPx, toDeviceSpan(0, bottom - top, scale).height);
        }
        const chunk = areaChunk(covered, bottom, actual, vh);
        if (!chunk) break; // 스크롤이 더 되지 않는다
        const src = toDeviceSpan(chunk.srcY, chunk.height, scale);
        const dest = toDeviceSpan(covered - top, chunk.height, scale);
        const sx = Math.round(x0 * scale);
        canvas
          .getContext('2d')!
          .drawImage(bitmap, sx, src.start, canvas.width, dest.height, 0, dest.start, canvas.width, dest.height);
        covered += chunk.height;
      } finally {
        bitmap.close();
      }
    }
    await send(tabId, { kind: 'restore' });
    if (!canvas) throw new Error('nothing captured');

    const shot: ShotRecord = {
      id: newId(),
      groupId: newId(),
      partIndex: 0,
      partCount: 1,
      createdAt: Date.now(),
      url: msg.url,
      title: msg.title,
      width: canvas.width,
      height: canvas.height,
      image: await canvas.convertToBlob({ type: 'image/png' }),
      thumb: await makeThumb(canvas),
      doc: emptyDoc({ position: settings.stampPosition, dateFormat: settings.stampDateFormat }),
      links: [], // TODO(추정): 페이지 일부 촬영에는 PDF 링크를 넣지 않는다
    };
    await putShot(shot);
    if (settings.autoDownload) await autoDownloadShots([shot], settings);
    else await chrome.tabs.create({ url: chrome.runtime.getURL(`result.html?id=${shot.id}`), index: tab.index + 1 });
    return shot;
  } catch (e) {
    await send(tabId, { kind: 'restore' }).catch(() => undefined);
    throw e;
  }
}
