// 설정 화면 (SET-01 ~ SET-03, SET-10 ~ SET-16, SET-20 ~ SET-23, CAP-01 크롬 단축키)
import { FOLDER_NAME_MAX, checkFolderName } from '../../core/fileName';
import { DEFAULT_SETTINGS, SCROLL_DELAY_OPTIONS, WAIT_IMAGES_OPTIONS, type PdfPaper, type Settings } from '../../core/settings';
import { applyI18n, t } from '../../shared/i18n';
import { loadSettings, saveSettings } from '../../shared/settingsStore';
import { icons } from '../../shared/icons';
import { $, applyIcons, openReport, toast } from '../../shared/ui';

applyI18n();
applyIcons();

const O = t.options;
let settings: Settings;

async function save(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch);
  render();
}

function fillSelect(sel: HTMLSelectElement, values: number[], label: (v: number) => string, current: number): void {
  sel.textContent = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = label(v);
    opt.selected = v === current;
    sel.appendChild(opt);
  }
}

function bindSwitch(id: string, key: keyof Settings): void {
  const el = $(`#${id}`) as HTMLInputElement;
  el.addEventListener('change', () => void save({ [key]: el.checked } as Partial<Settings>));
}

function render(): void {
  document.querySelectorAll<HTMLButtonElement>('#file-format button').forEach((b) => {
    b.classList.toggle('on', b.dataset.value === settings.fileFormat);
    b.setAttribute('aria-pressed', String(b.dataset.value === settings.fileFormat));
  });
  fillSelect($('#scroll-delay') as HTMLSelectElement, SCROLL_DELAY_OPTIONS, (v) => O.ms(v) + (v === DEFAULT_SETTINGS.scrollDelayMs ? O.defaultMark : ''), settings.scrollDelayMs);
  fillSelect($('#wait-images') as HTMLSelectElement, WAIT_IMAGES_OPTIONS, (v) => (v === 0 ? O.off : O.upTo(v / 1000)), settings.waitImagesMs);
  const folder = $('#save-folder') as HTMLInputElement;
  if (document.activeElement !== folder) folder.value = settings.saveFolder;
  ($('#ask-where') as HTMLInputElement).checked = settings.askWhereToSave;
  ($('#auto-download') as HTMLInputElement).checked = settings.autoDownload;
  ($('#shrink-copy') as HTMLInputElement).checked = settings.shrinkCopy;
  ($('#smooth-strokes') as HTMLInputElement).checked = settings.smoothStrokes;
  ($('#smart-break') as HTMLInputElement).checked = settings.pdfSmartBreak;
  ($('#pdf-links') as HTMLInputElement).checked = settings.pdfLinks;
  ($('#pdf-header') as HTMLInputElement).checked = settings.pdfHeader;

  const papers = $('#papers');
  papers.textContent = '';
  (['full', 'letter', 'legal', 'a4'] as PdfPaper[]).forEach((p) => {
    const b = document.createElement('button');
    b.className = 'paper' + (p === settings.pdfPaper ? ' on' : '');
    b.setAttribute('aria-pressed', String(p === settings.pdfPaper));
    b.innerHTML = `<span class="paper-icon">${p === 'full' ? icons.pageSingle : icons.pageMulti}</span><span class="paper-text"><span class="t"></span><span class="d"></span></span><span class="paper-check">${icons.check}</span>`;
    b.querySelector('.t')!.textContent = O.papers[p].title;
    b.querySelector('.d')!.textContent = O.papers[p].desc;
    b.addEventListener('click', () => void save({ pdfPaper: p }));
    papers.appendChild(b);
  });
  // 방향은 고정 크기 용지에만 쓴다 (전체 이미지는 이미지 크기 그대로)
  const isFull = settings.pdfPaper === 'full';
  $('#orientation-row').classList.toggle('disabled', isFull);
  document.querySelectorAll<HTMLButtonElement>('#orientation button').forEach((b) => {
    b.disabled = isFull;
    b.classList.toggle('on', b.dataset.value === settings.pdfOrientation);
    b.setAttribute('aria-pressed', String(b.dataset.value === settings.pdfOrientation));
  });
}

function saveFolder(): void {
  const input = $('#save-folder') as HTMLInputElement;
  const err = $('#folder-error');
  const r = checkFolderName(input.value);
  if (!r.ok) {
    const msg = O.folderErrors[r.reason];
    err.textContent = typeof msg === 'function' ? msg(FOLDER_NAME_MAX) : msg;
    err.hidden = false;
    return;
  }
  err.hidden = true;
  input.value = r.value;
  void save({ saveFolder: r.value }).then(() => toast(O.saveFolderSaved));
}

/** 크롬에 등록된 단축키 3가지를 보여 준다 (CAP-01, PR #1 요청). 키는 크롬의 단축키 화면에서 바꾼다 */
async function renderShortcut(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const order = ['_execute_action', 'capture-full', 'capture-area'];
  const list = $('#shortcut-list');
  list.textContent = '';
  for (const name of order) {
    const c = commands.find((x) => x.name === name);
    if (!c) continue;
    const row = document.createElement('div');
    row.className = 'row shortcut-row';
    row.innerHTML = '<div class="text"><div class="name"></div></div><kbd class="key"></kbd>';
    row.querySelector('.name')!.textContent = O.shortcutNames[name] ?? c.description ?? name;
    const key = row.querySelector('.key')!;
    key.textContent = c.shortcut || O.shortcutNotSet;
    key.classList.toggle('unset', !c.shortcut);
    list.appendChild(row);
  }
}

async function main(): Promise<void> {
  settings = await loadSettings();
  render();
  document.querySelectorAll<HTMLButtonElement>('#file-format button').forEach((b) =>
    b.addEventListener('click', () => void save({ fileFormat: b.dataset.value as Settings['fileFormat'] })),
  );
  $('#scroll-delay').addEventListener('change', (e) => void save({ scrollDelayMs: Number((e.target as HTMLSelectElement).value) }));
  $('#wait-images').addEventListener('change', (e) => void save({ waitImagesMs: Number((e.target as HTMLSelectElement).value) }));
  $('#save-folder-btn').addEventListener('click', saveFolder);
  $('#save-folder').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') saveFolder();
  });
  bindSwitch('ask-where', 'askWhereToSave');
  bindSwitch('auto-download', 'autoDownload');
  bindSwitch('shrink-copy', 'shrinkCopy');
  bindSwitch('smooth-strokes', 'smoothStrokes');
  bindSwitch('smart-break', 'pdfSmartBreak');
  bindSwitch('pdf-links', 'pdfLinks');
  bindSwitch('pdf-header', 'pdfHeader');
  document.querySelectorAll<HTMLButtonElement>('#orientation button').forEach((b) =>
    b.addEventListener('click', () => void save({ pdfOrientation: b.dataset.value as Settings['pdfOrientation'] })),
  );
  $('#report-btn').addEventListener('click', openReport);
  $('#gallery-btn').addEventListener('click', () => location.assign('gallery.html'));
  $('#shortcut-btn').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  await renderShortcut();
  window.addEventListener('focus', () => void renderShortcut());
}

void main();
