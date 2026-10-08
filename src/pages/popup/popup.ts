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
  for (const v of ['progress-view', 'blocked-view', 'message-view']) $(`#${v}`).hidden = v !== id;
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

  show('progress-view');
  render({ kind: 'progress', current: 0, total: 0, stage: 'scroll', paused: false, width: 0, height: 0 });
  const port = chrome.runtime.connect({ name: POPUP_PORT });
  const post = (m: PopupToWorker) => port.postMessage(m);
  port.onMessage.addListener(render);
  post({ kind: 'open', tabId: tab.id, windowId: tab.windowId });

  $('#pause-btn').addEventListener('click', () => post({ kind: 'togglePause' }));
  $('#stop-btn').addEventListener('click', () => {
    post({ kind: 'stop' });
    window.close();
  });
  $('#message-close').addEventListener('click', () => window.close());
}

void main();
