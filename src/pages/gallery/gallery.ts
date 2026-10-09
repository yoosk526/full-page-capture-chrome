// 내 스크린샷 (GAL-01 ~ GAL-09)
import { cardMeta, cardTitle, matchesQuery } from '../../core/gallery';
import { outputLayout } from '../../core/stamp';
import { deleteShots, getShot, listShots } from '../../shared/db';
import { downloadBlob } from '../../shared/download';
import { applyI18n, t } from '../../shared/i18n';
import { icons } from '../../shared/icons';
import { loadSettings } from '../../shared/settingsStore';
import type { ShotRecord } from '../../shared/types';
import { $, applyIcons, openPage, toast } from '../../shared/ui';
import { exportShot } from '../../render/exportShot';

applyI18n();
applyIcons();

const G = t.gallery;
let shots: ShotRecord[] = [];
let selecting = false;
const selected = new Set<string>();
const thumbUrls = new Map<string, { blob: Blob; url: string }>();

function visible(): ShotRecord[] {
  const q = ($('#search') as HTMLInputElement).value;
  return shots.filter((s) => matchesQuery(s, q));
}

/** 썸네일 주소. 편집기에서 썸네일이 새로 만들어졌으면 새 주소를 만들고 옛 주소는 풀어 준다 */
function thumbUrl(s: ShotRecord): string {
  const cached = thumbUrls.get(s.id);
  if (cached && cached.blob === s.thumb) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(s.thumb);
  thumbUrls.set(s.id, { blob: s.thumb, url });
  return url;
}

function iconButton(icon: keyof typeof icons, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.innerHTML = icons[icon];
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

async function removeOne(s: ShotRecord): Promise<void> {
  if (!confirm(t.result.deleteConfirm)) return;
  await deleteShots([s.id]);
  toast(t.toast.deleted);
  await reload();
}

function card(s: ShotRecord): HTMLElement {
  const el = document.createElement('article');
  el.className = 'card' + (selected.has(s.id) ? ' selected' : '');
  const title = cardTitle(s.title, s.partIndex, s.partCount, t.common.untitled);
  const L = outputLayout(s.doc, s.width, s.height);
  el.innerHTML = `<div class="thumb"><img alt="" loading="lazy" /><div class="hover-icons"></div><span class="check">${icons.check}</span></div>
    <div class="info"><div class="name"></div><div class="meta"></div></div>`;
  (el.querySelector('img') as HTMLImageElement).src = thumbUrl(s);
  el.querySelector('.name')!.textContent = title;
  el.title = title; // 제목 전체를 말풍선으로 (GAL-03)
  el.querySelector('.meta')!.textContent = cardMeta(s.url, L.width, L.height, s.createdAt);
  const hover = el.querySelector('.hover-icons')!;
  // TODO(추정): 세 아이콘의 동작은 화면 모양으로 짐작했다 (크게 보기 = 결과 화면, 편집 = 편집기, 삭제)
  hover.append(
    iconButton('expand', G.view, () => openPage(`result.html?id=${s.id}`)),
    iconButton('edit', G.edit, () => openPage(`editor.html?id=${s.id}`)),
    iconButton('trash', G.deleteOne, () => void removeOne(s)),
  );
  el.addEventListener('click', () => {
    if (selecting) {
      // TODO(미확인): 카드를 하나씩 눌러 고르는 방법을 모른다. 선택 모드에서 카드를 누르면 고르거나 뺀다
      if (selected.has(s.id)) selected.delete(s.id);
      else selected.add(s.id);
      render();
    } else {
      openPage(`result.html?id=${s.id}`);
    }
  });
  return el;
}

function render(): void {
  const list = visible();
  $('#count').textContent = G.count(shots.length);
  const allSelected = selecting && list.length > 0 && list.every((s) => selected.has(s.id));
  $('#select-all-label').textContent = allSelected ? G.deselectAll : G.selectAll;
  ($('#select-all') as HTMLButtonElement).disabled = list.length === 0;
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = shots.length === 0 ? G.empty : G.noMatch;
  const grid = $('#grid');
  grid.classList.toggle('selecting', selecting);
  grid.textContent = '';
  for (const s of list) grid.appendChild(card(s));
  $('#select-bar').hidden = !selecting;
  $('#selected-count').textContent = G.selected(selected.size);
  $('#save-selected-label').textContent = G.saveAll(selected.size);
  ($('#delete-selected') as HTMLButtonElement).disabled = selected.size === 0;
  ($('#save-selected') as HTMLButtonElement).disabled = selected.size === 0;
}

async function reload(): Promise<void> {
  shots = await listShots();
  const ids = new Set(shots.map((s) => s.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  for (const [id, { url }] of thumbUrls) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(id);
    }
  }
  render();
}

function exitSelecting(): void {
  selecting = false;
  selected.clear();
  render();
}

/** 고른 스크린샷을 압축하지 않고 파일 하나씩 따로 저장한다 (GAL-05). 여러 개일 때는 저장 위치를 묻지 않는다 */
async function saveSelected(): Promise<void> {
  const settings = await loadSettings();
  const ids = shots.filter((s) => selected.has(s.id)).map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    const s = await getShot(id);
    if (!s) continue;
    try {
      const { blob, filename } = await exportShot(s, settings.fileFormat, settings);
      await downloadBlob(blob, filename, settings.askWhereToSave && ids.length === 1);
    } catch (e) {
      console.error(e);
      failed++;
    }
  }
  toast(failed ? t.toast.saveFailed : t.toast.saved);
}

async function deleteSelected(): Promise<void> {
  // TODO(미확인): 선택 삭제 때 확인 창이 뜨는지 모른다. 되돌릴 수 없으므로 확인을 받는다
  if (!confirm(G.deleteManyConfirm(selected.size))) return;
  await deleteShots([...selected]);
  selected.clear();
  toast(t.toast.deleted);
  await reload();
}

$('#select-all').addEventListener('click', () => {
  const list = visible();
  const allSelected = selecting && list.every((s) => selected.has(s.id));
  if (allSelected) {
    exitSelecting();
    return;
  }
  selecting = true;
  for (const s of list) selected.add(s.id);
  render();
});
$('#close-select').addEventListener('click', exitSelecting);
$('#save-selected').addEventListener('click', () => void saveSelected());
$('#delete-selected').addEventListener('click', () => void deleteSelected());
$('#search').addEventListener('input', render);
$('#settings-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#batch-btn').addEventListener('click', () => openPage('batch.html'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selecting) exitSelecting();
});
// 다른 탭에서 촬영·편집·삭제한 내용을 돌아올 때 반영한다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void reload();
});

void reload();
