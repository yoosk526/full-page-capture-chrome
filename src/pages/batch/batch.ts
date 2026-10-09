// 일괄 촬영 화면 (SET-32, PR #1 요청)
import { BATCH_MAX, parseUrlList } from '../../core/batch';
import { applyI18n, t } from '../../shared/i18n';
import { BATCH_PORT, type BatchToWorker, type WorkerToBatch } from '../../shared/messages';
import { $, applyIcons, openPage } from '../../shared/ui';

applyI18n();
applyIcons();

const B = t.batch;
const ALL_SITES = { origins: ['<all_urls>'] };
const textarea = $('#urls') as HTMLTextAreaElement;
$('#list-desc').textContent = B.listDesc(BATCH_MAX);

let port: chrome.runtime.Port | null = null;

function showMessage(text: string): void {
  const m = $('#message');
  m.textContent = text;
  m.hidden = !text;
}

/** 여러 페이지를 차례로 열어 찍으려면 "모든 사이트" 접근이 필요하다. 쓸 때만 묻는다 (PR #1 답변 C ①) */
async function ensurePermission(): Promise<boolean> {
  if (await chrome.permissions.contains(ALL_SITES)) return true;
  showMessage(B.permission);
  const granted = await chrome.permissions.request(ALL_SITES);
  if (!granted) showMessage(B.permissionDenied);
  return granted;
}

$('#add-tabs').addEventListener('click', async () => {
  if (!(await ensurePermission())) return;
  showMessage('');
  const tabs = await chrome.tabs.query({});
  const current = textarea.value.trim();
  const found = tabs.map((tab) => tab.url ?? '').filter((u) => /^https?:/.test(u));
  textarea.value = [current, ...found].filter(Boolean).join('\n');
});

$('#clear-btn').addEventListener('click', () => {
  textarea.value = '';
  showMessage('');
});

$('#gallery-btn').addEventListener('click', () => openPage('gallery.html'));
$('#open-gallery').addEventListener('click', () => openPage('gallery.html'));

function setRunning(running: boolean): void {
  ($('#start-btn') as HTMLButtonElement).disabled = running;
  ($('#add-tabs') as HTMLButtonElement).disabled = running;
  ($('#clear-btn') as HTMLButtonElement).disabled = running;
  textarea.disabled = running;
  $('#stop-btn').hidden = !running;
}

function onMessage(msg: WorkerToBatch): void {
  const list = $('#items');
  if (msg.kind === 'item') {
    let li = list.children[msg.index] as HTMLLIElement | undefined;
    while (!li) {
      list.appendChild(document.createElement('li'));
      li = list.children[msg.index] as HTMLLIElement | undefined;
    }
    li.className = msg.status;
    const label = msg.status === 'ok' ? ` — ${B.ok}` : msg.status === 'failed' ? ` — ${B.failed}` : '';
    li.textContent = msg.url + label;
    if (msg.error) li.title = msg.error;
    const finished = msg.status === 'running' ? msg.index : msg.index + 1;
    $('#progress-text').textContent = B.progress(Math.min(msg.index + 1, msg.total), msg.total);
    $('#bar-fill').style.width = `${(finished / msg.total) * 100}%`;
  } else {
    setRunning(false);
    if (!msg.stopped) $('#bar-fill').style.width = '100%';
    $('#progress-text').textContent = msg.stopped ? B.stopped : B.done(msg.ok, msg.failed);
    $('#open-gallery').hidden = msg.ok === 0;
    port?.disconnect();
    port = null;
  }
}

$('#start-btn').addEventListener('click', async () => {
  const parsed = parseUrlList(textarea.value);
  if (parsed.urls.length === 0) {
    showMessage(B.empty);
    return;
  }
  if (!(await ensurePermission())) return;
  const notes = [parsed.invalid.length ? B.invalid(parsed.invalid.length) : '', parsed.overLimit ? B.overLimit(parsed.overLimit, BATCH_MAX) : ''];
  showMessage(notes.filter(Boolean).join(' '));
  $('#progress').hidden = false;
  $('#items').textContent = '';
  $('#open-gallery').hidden = true;
  setRunning(true);
  port = chrome.runtime.connect({ name: BATCH_PORT });
  port.onMessage.addListener(onMessage);
  port.postMessage({ kind: 'start', urls: parsed.urls } satisfies BatchToWorker);
});

$('#stop-btn').addEventListener('click', () => port?.postMessage({ kind: 'stop' } satisfies BatchToWorker));
