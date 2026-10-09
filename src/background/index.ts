// 서비스 워커: 툴바 팝업과 연결해 촬영을 진행한다.
// 팝업이 열리면 촬영 시작(또는 이어서), 팝업이 닫히면(연결이 끊기면) 잠시 멈춤 (CAP-03, CAP-04)
import { POPUP_PORT, type AreaSelected, type PopupToWorker, type WorkerToPopup } from '../shared/messages';
import { captureArea, startAreaSelect } from './area';
import { loadSettings } from '../shared/settingsStore';
import { CancelledError, CaptureSession } from './capture';
import { autoDownloadShots } from './autoDownload';

let session: CaptureSession | null = null;
/** 단축키 "페이지 전체 찍기"로 팝업을 열었을 때, 팝업이 고르는 창 없이 바로 시작하도록 표시해 둔다 */
let autoStartFullTab: { tabId: number; at: number } | null = null;

function startSession(tabId: number, windowId: number, port: chrome.runtime.Port | null): CaptureSession {
  const s = new CaptureSession(tabId, windowId);
  session = s;
  if (port) attachPort(s, port);
  void runSession(s);
  return s;
}

async function runSession(s: CaptureSession): Promise<void> {
  let isFile = false;
  try {
    const settings = await loadSettings();
    const tab = await chrome.tabs.get(s.tabId);
    isFile = (tab.url ?? '').startsWith('file:');
    const shots = await s.run(settings);
    if (settings.autoDownload) {
      // 설정 SET-15: 결과 화면을 열지 않고 곧바로 파일로 내려받는다
      await autoDownloadShots(shots, settings);
      s.reportDone(true);
    } else {
      s.reportDone(false);
      await chrome.tabs.create({ url: chrome.runtime.getURL(`result.html?id=${shots[0].id}`), index: tab.index + 1 });
    }
  } catch (e) {
    if (!(e instanceof CancelledError)) {
      console.error('[capture]', e);
      s.reportError(e, isFile);
    }
  } finally {
    if (session === s) session = null;
  }
}

function attachPort(s: CaptureSession, port: chrome.runtime.Port): void {
  s.attach((msg: WorkerToPopup) => {
    try {
      port.postMessage(msg);
    } catch {
      // 팝업이 이미 닫혔다
    }
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== POPUP_PORT) return;
  let mine: CaptureSession | null = null;

  port.onMessage.addListener((msg: PopupToWorker) => {
    if (msg.kind === 'query') {
      // 이 탭에서 촬영이 진행(멈춤) 중이면 고르는 창 없이 이어서 보여 준다
      const active = !!session && !session.done && session.tabId === msg.tabId;
      const autoStartFull = !!autoStartFullTab && autoStartFullTab.tabId === msg.tabId && Date.now() - autoStartFullTab.at < 10_000;
      autoStartFullTab = null;
      port.postMessage({ kind: 'state', active, autoStartFull } satisfies WorkerToPopup);
    } else if (msg.kind === 'area') {
      void startAreaSelect(msg.tabId).catch((e) => console.error('[area]', e));
    } else if (msg.kind === 'open') {
      if (session && !session.done && session.tabId === msg.tabId) {
        // 같은 탭에서 다시 열면 이어서 진행한다
        mine = session;
        attachPort(session, port);
        session.resume();
      } else {
        // 다른 탭에서 멈춰 있던 촬영은 취소하고 새로 시작한다
        session?.cancel();
        mine = startSession(msg.tabId, msg.windowId, port);
      }
    } else if (msg.kind === 'togglePause') {
      if (!mine) return;
      if (mine.paused) mine.resume();
      else mine.pause();
    } else if (msg.kind === 'stop') {
      mine?.cancel();
    }
  });

  port.onDisconnect.addListener(() => {
    if (mine && !mine.done) {
      mine.attach(null);
      mine.pause();
    }
  });
});

// 단축키 (CAP-01, PR #1 요청: 3가지)
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id || tab.windowId === undefined) return;
  if (command === 'capture-full') {
    autoStartFullTab = { tabId: tab.id, at: Date.now() };
    // 진행 상황을 보여 주도록 팝업을 연다. 열 수 없으면 팝업 없이 바로 찍는다
    chrome.action.openPopup().catch(() => {
      autoStartFullTab = null;
      if (!session || session.done) startSession(tab.id!, tab.windowId, null);
    });
  } else if (command === 'capture-area') {
    void startAreaSelect(tab.id).catch((e) => console.error('[area]', e));
  }
});

// 영역 고르기 화면에서 영역을 다 골랐다
chrome.runtime.onMessage.addListener((msg: AreaSelected, sender, sendResponse) => {
  if (msg?.kind !== 'areaSelected' || !sender.tab) return;
  captureArea(sender.tab, msg).then(
    () => sendResponse({ ok: true }),
    (e) => {
      console.error('[area]', e);
      sendResponse({ ok: false, error: String(e) });
    },
  );
  return true;
});
