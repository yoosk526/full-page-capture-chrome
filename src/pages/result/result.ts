// 결과 화면 (RES-01 ~ RES-08)
import { clampZoom, fitZoom, formatZoom, zoomIn, zoomOut } from '../../core/zoom';
import { outputLayout } from '../../core/stamp';
import type { FileFormat } from '../../core/settings';
import { deleteShots, getShot, listGroup } from '../../shared/db';
import { applyI18n, t } from '../../shared/i18n';
import { loadSettings } from '../../shared/settingsStore';
import type { ShotRecord } from '../../shared/types';
import { $, applyIcons, bindMenu, openReport } from '../../shared/ui';
import { renderShotPng, shotBaseName } from '../../render/exportShot';
import { copyShot, printShot, saveShot } from '../shared/shotActions';

applyI18n();
applyIcons();

const FORMAT_LABEL: Record<FileFormat, string> = { png: 'PNG', jpg: 'JPG', pdf: 'PDF' };

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
let shot: ShotRecord | undefined;
let zoom = 1;
let objectUrl = '';
let loadedOnce = false;
let outSize = { w: 1, h: 1 };

const img = $('#preview') as HTMLImageElement;
const viewport = $('#viewport');

function applyZoom(z: number): void {
  if (!shot) return;
  zoom = z;
  // 내림으로 맞춰야 화면 맞춤에서 0.5px 차이로 스크롤 막대가 생기지 않는다
  img.style.width = `${Math.floor(outSize.w * zoom)}px`;
  img.style.height = `${Math.floor(outSize.h * zoom)}px`;
  $('#zoom-label').textContent = formatZoom(zoom);
}

function fit(): number {
  if (!shot) return 1;
  const cs = getComputedStyle(viewport);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  return fitZoom(outSize.w, outSize.h, viewport.clientWidth - padX, viewport.clientHeight - padY);
}

async function renderParts(current: ShotRecord): Promise<void> {
  if (current.partCount <= 1) return;
  const group = await listGroup(current.groupId);
  const box = $('#parts');
  box.hidden = false;
  box.title = t.result.partsNotice(current.partCount);
  box.textContent = '';
  for (const p of group) {
    const b = document.createElement('button');
    b.className = 'btn' + (p.id === current.id ? ' current' : '');
    b.textContent = t.result.part(p.partIndex + 1, p.partCount);
    b.addEventListener('click', () => location.replace(`result.html?id=${p.id}`));
    box.appendChild(b);
  }
}

async function load(): Promise<void> {
  shot = await getShot(id);
  if (!shot) {
    $('#not-found').hidden = false;
    img.hidden = true;
    document.querySelectorAll<HTMLButtonElement>('.actions button, #delete-btn').forEach((b) => (b.disabled = true));
    return;
  }
  document.title = `${shot.title || t.common.untitled} - ${t.appName}`;
  $('#file-name').textContent = shotBaseName(shot);
  $('#file-name').title = shotBaseName(shot);
  const out = outputLayout(shot.doc, shot.width, shot.height);
  $('#image-size').textContent = t.common.sizePx(out.width, out.height);
  outSize = { w: out.width, h: out.height };
  // 편집한 내용이 있으면 편집이 반영된 미리보기를 보여 준다 (RES-08)
  const nextUrl = URL.createObjectURL(await renderShotPng(shot));
  // 동시에 두 번 불려도 이전 주소를 모두 풀어 준다
  const prevUrl = objectUrl;
  objectUrl = nextUrl;
  img.src = nextUrl;
  if (prevUrl && prevUrl !== nextUrl) URL.revokeObjectURL(prevUrl);
  applyZoom(loadedOnce ? zoom : fit());
  loadedOnce = true;
  await renderParts(shot);
}

async function setupSaveButton(): Promise<void> {
  const settings = await loadSettings();
  // TODO(미확인): 저장 버튼 글자가 설정의 파일 형식을 따라 바뀌는지 모른다. 여기서는 따라 바꾼다.
  $('#save-label').textContent =
    settings.fileFormat === 'pdf' ? t.result.savePdf : t.result.saveAs(FORMAT_LABEL[settings.fileFormat]);
  $('#m-png').textContent = t.result.saveAs('PNG');
  $('#m-jpg').textContent = t.result.saveAs('JPG');
  $('#save-btn').onclick = () => shot && void saveShot(shot, settings.fileFormat);
}

$('#zoom-in').addEventListener('click', () => applyZoom(zoomIn(zoom)));
$('#zoom-out').addEventListener('click', () => applyZoom(zoomOut(zoom)));
$('#zoom-fit').addEventListener('click', () => applyZoom(fit()));
$('#edit-btn').addEventListener('click', () => location.assign(`editor.html?id=${id}`));
$('#copy-btn').addEventListener('click', () => shot && void copyShot(shot));
$('#print-btn').addEventListener('click', () => shot && void printShot(shot));
// 새 탭을 만들지 않고 이 탭에서 화면을 바꾼다 (PR #1 두 번째 요청)
$('#gallery-btn').addEventListener('click', () => location.assign('gallery.html'));
$('#settings-btn').addEventListener('click', () => location.assign('options.html'));
$('#report-btn').addEventListener('click', openReport);
$('#delete-btn').addEventListener('click', async () => {
  if (!shot || !confirm(t.result.deleteConfirm)) return;
  await deleteShots([shot.id]);
  // TODO(미확인): 지운 뒤 어느 화면으로 가는지 모른다. 내 스크린샷 화면으로 간다.
  location.replace('gallery.html');
});

// Cmd(Windows는 Ctrl)를 누른 채 휠을 굴리면 마우스가 가리키는 곳을 중심으로 확대·축소한다 (PR #1 두 번째 요청)
viewport.addEventListener(
  'wheel',
  (e) => {
    if (!shot || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const ax = e.clientX - r.left;
    const ay = e.clientY - r.top;
    const fx = (viewport.scrollLeft + ax) / viewport.scrollWidth;
    const fy = (viewport.scrollTop + ay) / viewport.scrollHeight;
    applyZoom(clampZoom(zoom * Math.exp(-e.deltaY * 0.002)));
    viewport.scrollLeft = fx * viewport.scrollWidth - ax;
    viewport.scrollTop = fy * viewport.scrollHeight - ay;
  },
  { passive: false },
);

const menu = $('#save-menu');
// 화살표에 마우스를 올리기만 해도 형식 메뉴가 열린다 (PR #1 요청)
bindMenu($('#save-more'), menu, { hover: true, anchor: $('#save-split') });
menu.querySelectorAll<HTMLButtonElement>('button[data-format]').forEach((b) =>
  b.addEventListener('click', () => {
    menu.hidden = true;
    if (shot) void saveShot(shot, b.dataset.format as FileFormat);
  }),
);

// 편집기에서 돌아오면(뒤로 가기, 다른 탭에서 편집) 새 내용으로 다시 읽는다 (RES-08)
window.addEventListener('pageshow', (e) => {
  if (e.persisted) void load();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void load();
});

void setupSaveButton();
void load();
