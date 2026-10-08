// 촬영 한 번을 맡는다: 페이지 준비 → 스크롤하며 조각 촬영 → 이어 붙이기 → 기기에 보관
import { fitToCaptured, outputHeightCss, placeChunk, planScrollPositions } from '../core/capturePlan';
import { delayBeforeNextCall } from '../core/throttle';
import { emptyDoc } from '../core/doc';
import type { Settings } from '../core/settings';
import { newId, putShot } from '../shared/db';
import type { ContentRequest, PageMetrics, WorkerToPopup, CaptureStage } from '../shared/messages';
import type { LinkRect, ShotRecord } from '../shared/types';
import { Stitcher } from './stitcher';

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

/** 잠시 멈춘 상태로 기다리는 최대 시간. TODO(미확인): 기존 프로그램의 한도는 모름 */
const PAUSE_TIMEOUT_MS = 10 * 60 * 1000;
/** 서비스 워커가 멈춘 동안 꺼지지 않도록 확장 API를 부르는 간격 */
const KEEPALIVE_MS = 20 * 1000;
/** 캡처 호출이 빈도 제한에 걸렸을 때 다시 시도하는 횟수 */
const CAPTURE_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function send<T>(tabId: number, req: ContentRequest): Promise<T> {
  const res = (await chrome.tabs.sendMessage(tabId, req)) as { ok: boolean; value?: T; error?: string } | undefined;
  if (!res) throw new Error('no response from page');
  if (!res.ok) throw new Error(res.error);
  return res.value as T;
}

export class CaptureSession {
  paused = false;
  done = false;
  private cancelled = false;
  private resumeWaiters: (() => void)[] = [];
  private lastCaptureAt: number | null = null;
  private listener: ((msg: WorkerToPopup) => void) | null = null;
  private last: WorkerToPopup | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  private settings!: Settings;

  constructor(
    readonly tabId: number,
    readonly windowId: number,
  ) {}

  /** 팝업이 붙으면 마지막 진행 상황을 바로 보낸다 */
  attach(listener: ((msg: WorkerToPopup) => void) | null): void {
    this.listener = listener;
    if (listener && this.last) listener(this.last);
  }

  private emit(msg: WorkerToPopup): void {
    this.last = msg;
    this.listener?.(msg);
  }

  private progress(current: number, total: number, stage: CaptureStage, width: number, height: number): void {
    this.emit({ kind: 'progress', current, total, stage, paused: this.paused, width, height });
  }

  pause(): void {
    if (this.paused || this.done || this.cancelled) return;
    this.paused = true;
    if (this.last?.kind === 'progress') this.emit({ ...this.last, paused: true });
    send(this.tabId, { kind: 'suspend' }).catch(() => undefined);
    this.keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), KEEPALIVE_MS);
    this.pauseTimer = setTimeout(() => this.cancel(), PAUSE_TIMEOUT_MS);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.keepAlive = this.pauseTimer = null;
    if (this.last?.kind === 'progress') this.emit({ ...this.last, paused: false });
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((w) => w());
  }

  /** 촬영 중지: 부분 결과 없이 그냥 취소한다 (CAP-05) */
  cancel(): void {
    this.cancelled = true;
    this.resume();
  }

  /** 멈춰 있으면 다시 시작할 때까지 기다린다. 다시 시작하면 페이지 모양을 촬영용으로 되돌린다 */
  private async checkpoint(): Promise<void> {
    if (this.cancelled) throw new CancelledError();
    if (!this.paused) return;
    await new Promise<void>((r) => this.resumeWaiters.push(r));
    if (this.cancelled) throw new CancelledError();
    await send(this.tabId, { kind: 'reapply' });
  }

  private async captureVisible(): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      await sleep(delayBeforeNextCall(this.lastCaptureAt, Date.now()));
      this.lastCaptureAt = Date.now();
      try {
        return await chrome.tabs.captureVisibleTab(this.windowId, { format: 'png' });
      } catch (e) {
        // 초당 호출 한도(MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND)에 걸리면 조금 쉬고 다시 시도한다
        if (attempt < CAPTURE_RETRIES && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(e))) continue;
        throw e;
      }
    }
  }

  /** 촬영을 끝까지 진행하고 보관한 스크린샷 목록을 돌려준다 */
  async run(settings: Settings): Promise<ShotRecord[]> {
    this.settings = settings;
    const tabId = this.tabId;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      let m = await send<PageMetrics>(tabId, { kind: 'prepare' });
      // 조각 수는 첫 조각을 찍어 실제 보이는 높이를 확인한 뒤 정한다
      let positions = [0];
      const createdAt = Date.now();

      let stitcher: Stitcher | null = null;
      let covered = 0;
      for (let i = 0; i < positions.length; i++) {
        await this.checkpoint();
        this.progress(i + 1, positions.length, 'scroll', stitcher?.width ?? 0, stitcher?.height ?? 0);
        const actual = await send<number>(tabId, { kind: 'scrollTo', y: positions[i], index: i });
        await sleep(this.settings.scrollDelayMs);
        if (this.settings.waitImagesMs > 0) await send(tabId, { kind: 'waitImages', timeoutMs: this.settings.waitImagesMs });
        await this.checkpoint();
        const dataUrl = await this.captureVisible();
        const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
        if (!stitcher) {
          // 실제 이미지 폭 / 화면 폭 = 화면 배율(devicePixelRatio). 소수 배율도 그대로 쓴다
          const scale = bitmap.width / m.viewportWidth;
          m = { ...m, ...fitToCaptured(m, bitmap.height / scale) };
          positions = planScrollPositions(m.contentHeight, m.regionHeight);
          stitcher = new Stitcher(bitmap.width, Math.round(outputHeightCss(m) * scale), scale, m.background);
        }
        const place = placeChunk({
          isFirst: i === 0,
          isLast: i === positions.length - 1,
          actualScroll: actual,
          coveredUntil: covered,
          regionTop: m.regionTop,
          regionHeight: m.regionHeight,
          viewportHeight: m.viewportHeight,
        });
        stitcher.draw(bitmap, place.srcY, place.height, place.destY);
        bitmap.close();
        covered = place.coveredUntil;
        this.progress(i + 1, positions.length, 'scroll', stitcher.width, stitcher.height);
        await stitcher.flush(covered);
      }
      const total = positions.length;

      await send(tabId, { kind: 'restore' });
      if (!stitcher) throw new Error('nothing captured');
      this.progress(total, total, 'stitch', stitcher.width, stitcher.height);
      const parts = await stitcher.finish();
      this.progress(total, total, 'save', stitcher.width, stitcher.height);

      const scale = stitcher.width / m.viewportWidth;
      const groupId = newId();
      const stamp = { position: this.settings.stampPosition, dateFormat: this.settings.stampDateFormat };
      const shots: ShotRecord[] = parts.map((p, i) => ({
        id: newId(),
        groupId,
        partIndex: i,
        partCount: parts.length,
        createdAt,
        url: m.url,
        title: m.title,
        width: p.width,
        height: p.height,
        image: p.image,
        thumb: p.thumb,
        doc: emptyDoc(stamp),
        links: partLinks(m, scale, p.y, p.height),
      }));
      for (const s of shots) await putShot(s);
      this.done = true;
      return shots;
    } catch (e) {
      this.done = true;
      await send(tabId, { kind: 'restore' }).catch(() => undefined);
      throw e;
    } finally {
      if (this.keepAlive) clearInterval(this.keepAlive);
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
    }
  }

  reportDone(autoDownloaded: boolean): void {
    this.emit({ kind: 'done', autoDownloaded });
  }

  reportError(e: unknown, isFileUrl: boolean): void {
    const message = String(e instanceof Error ? e.message : e);
    // 로컬 파일인데 "파일 URL에 대한 액세스 허용"이 꺼져 있으면 페이지에 들어갈 수 없다
    const reason = isFileUrl && /Cannot access|permission/i.test(message) ? 'file-access' : 'generic';
    this.emit({ kind: 'error', reason, message });
  }
}

/** 링크 위치를 이 부분 이미지의 픽셀 좌표로 바꾼다 */
function partLinks(m: PageMetrics, scale: number, partY: number, partH: number): LinkRect[] {
  if (!m.documentScroll) return [];
  const out: LinkRect[] = [];
  for (const l of m.links) {
    const y = Math.round(l.y * scale) - partY;
    const h = Math.round(l.h * scale);
    if (y + h <= 0 || y >= partH) continue;
    out.push({ x: Math.round(l.x * scale), y, w: Math.round(l.w * scale), h, href: l.href });
  }
  return out;
}
