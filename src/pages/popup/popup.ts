// 툴바 팝업: 열리면 곧바로 촬영 시작 (CAP-01). 보호 페이지면 안내만 보여 준다 (CAP-11)
import { checkCaptureUrl } from '../../core/urlCheck';
import { applyI18n, t } from '../../shared/i18n';
import { icons } from '../../shared/icons';
import { POPUP_PORT, type PopupToWorker, type WorkerToPopup } from '../../shared/messages';
import { $, applyIcons } from '../../shared/ui';

/** TODO(미확인): 기존 프로그램의 "예시 페이지"가 어디로 연결되는지 모른다 */
const EXAMPLE_PAGE_URL = 'https://example.com/';

applyI18n();
applyIcons();

function show(id: string): void {
  for (const v of ['choose-view', 'progress-view', 'blocked-view', 'message-view']) $(`#${v}`).hidden = v !== id;
}

function showMessage(title: string, body: string): void {
  $('#message-title').textContent = title;
  $('#message-body').textContent = body;
  show('message-view');
}

function render(msg: WorkerToPopup): void {
  if (msg.kind === 'progress') {
    show('progress-view');
    $('#status-text').textContent = msg.paused ? t.popup.paused : t.popup.capturing;
    $('#dot').classList.toggle('paused', msg.paused);
    $('#count').textContent = t.popup.progress(msg.current, msg.total);
    const stage = { scroll: t.popup.stageScroll, stitch: t.popup.stageStitch, save: t.popup.stageSave }[msg.stage];
    $('#stage').textContent = stage;
    const pct = msg.total ? (msg.current / msg.total) * 100 : 0;
    $('#bar-fill').style.width = `${pct}%`;
    $('#page-fill').style.height = `${pct}%`;
    $('#size').textContent = msg.width ? t.common.sizePx(msg.width, msg.height) : '';
    const btn = $('#pause-btn');
    btn.innerHTML = msg.paused ? icons.play : icons.pause;
    btn.title = msg.paused ? t.popup.resume : t.popup.pause;
    btn.setAttribute('aria-label', btn.title);
  } else if (msg.kind === 'error') {
    showMessage(t.popup.error, msg.reason === 'file-access' ? t.popup.errorFileAccess : t.popup.errorGeneric(msg.message));
  } else if (msg.kind === 'done') {
    if (msg.autoDownloaded) showMessage(t.popup.autoDownloaded, '');
    else window.close();
  }
}

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || checkCaptureUrl(tab.url) !== 'ok') {
    show('blocked-view');
    $('#try-btn').addEventListener('click', () => {
      void chrome.tabs.create({ url: EXAMPLE_PAGE_URL });
      window.close();
    });
    $('#close-btn').addEventListener('click', () => window.close());
    return;
  }

  const port = chrome.runtime.connect({ name: POPUP_PORT });
  const post = (m: PopupToWorker) => port.postMessage(m);
  const tabId = tab.id;
  const startFull = () => {
    show('progress-view');
    render({ kind: 'progress', current: 0, total: 0, stage: 'scroll', paused: false, width: 0, height: 0 });
    post({ kind: 'open', tabId, windowId: tab.windowId });
  };
  port.onMessage.addListener((msg: WorkerToPopup) => {
    if (msg.kind !== 'state') return render(msg);
    // 이 탭에서 찍는 중(멈춤 포함)이면 이어서, 단축키로 열었으면 바로 시작, 아니면 고르는 창 (PR #1 요청)
    if (msg.active || msg.autoStartFull) startFull();
    else void showChooser();
  });
  post({ kind: 'query', tabId });

  async function showChooser(): Promise<void> {
    show('choose-view');
    const commands = await chrome.commands.getAll();
    const key = (name: string) => commands.find((c) => c.name === name)?.shortcut ?? '';
    $('#key-full').textContent = key('capture-full');
    $('#key-area').textContent = key('capture-area');
  }
  $('#choose-full').addEventListener('click', startFull);
  $('#choose-area').addEventListener('click', () => {
    post({ kind: 'area', tabId, windowId: tab.windowId });
    // 팝업이 닫혀야 페이지 위에서 영역을 끌 수 있다
    setTimeout(() => window.close(), 50);
  });
  $('#open-gallery').addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
    window.close();
  });
  $('#open-shortcuts').addEventListener('click', () => {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });

  $('#pause-btn').addEventListener('click', () => post({ kind: 'togglePause' }));
  $('#stop-btn').addEventListener('click', () => {
    post({ kind: 'stop' });
    window.close();
  });
  $('#message-close').addEventListener('click', () => window.close());
}

void main();
