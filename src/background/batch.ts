// 일괄 촬영 (SET-32, PR #1 요청): 주소마다 앞쪽 새 창에서 열고 페이지 전체를 찍어 보관한다
import type { Settings } from '../core/settings';
import type { WorkerToBatch } from '../shared/messages';
import { loadSettings } from '../shared/settingsStore';
import { CaptureSession } from './capture';

/** 페이지가 다 열릴 때까지 기다리는 최대 시간 */
const LOAD_TIMEOUT_MS = 30_000;
/** 다 열린 뒤 그림·글꼴이 자리 잡도록 조금 더 기다린다. TODO(추정) */
const SETTLE_MS = 800;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, LOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export class BatchRun {
  private stopped = false;
  private current: CaptureSession | null = null;

  constructor(private readonly report: (msg: WorkerToBatch) => void) {}

  stop(): void {
    this.stopped = true;
    this.current?.cancel();
  }

  async run(urls: string[]): Promise<void> {
    const settings: Settings = await loadSettings();
    const win = await chrome.windows.create({ url: 'about:blank', focused: true, type: 'normal' });
    const tabId = win?.tabs?.[0]?.id;
    let ok = 0;
    let failed = 0;
    try {
      if (!win?.id || tabId === undefined) throw new Error('window not created');
      for (let i = 0; i < urls.length && !this.stopped; i++) {
        const url = urls[i];
        this.report({ kind: 'item', index: i, total: urls.length, url, status: 'running' });
        try {
          const loaded = waitForLoad(tabId);
          await chrome.tabs.update(tabId, { url, active: true });
          await loaded;
          await sleep(SETTLE_MS);
          if (this.stopped) break;
          await chrome.windows.update(win.id, { focused: true });
          this.current = new CaptureSession(tabId, win.id);
          // 일괄 촬영은 "파일 자동 다운로드"와 관계없이 내 스크린샷에 보관만 한다. TODO(추정)
          await this.current.run(settings);
          ok++;
          this.report({ kind: 'item', index: i, total: urls.length, url, status: 'ok' });
        } catch (e) {
          if (this.stopped) break;
          failed++;
          this.report({ kind: 'item', index: i, total: urls.length, url, status: 'failed', error: String(e instanceof Error ? e.message : e) });
        } finally {
          this.current = null;
        }
      }
    } finally {
      if (win?.id) await chrome.windows.remove(win.id).catch(() => undefined);
      this.report({ kind: 'finished', ok, failed, stopped: this.stopped });
    }
  }
}
