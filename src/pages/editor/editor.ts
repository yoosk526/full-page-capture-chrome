// 편집기 (EDT-01 ~ EDT-17)
import { clampCrop, normalizeRect } from '../../core/crop';
import type { EditorDoc, EditorObject, ObjectType, Rect, StampDateFormat, StampPosition } from '../../core/doc';
import {
  DEFAULT_TOOL_STYLES,
  HIGHLIGHTER_WIDTH,
  HIT_TOLERANCE_PX,
  LIMITS,
  PALETTE,
  addBadge,
  addObject,
  boundsOf,
  clampValue,
  defaultBadgeSize,
  handlePosition,
  handlesFor,
  hitTest,
  moveLayer,
  moveObjects,
  newObjectId,
  removeObject,
  removeObjects,
  cloneManyInto,
  resizeObject,
  updateObject,
  type Handle,
  type LimitKey,
  type ToolStyle,
} from '../../core/editorModel';
import { History } from '../../core/history';
import { constrainSquare, snapStraight } from '../../core/constrain';
import type { FileFormat } from '../../core/settings';
import { resolveShortcut, type EditorAction, type ToolId } from '../../core/shortcuts';
import { EDITOR_INITIAL_ZOOM, clampZoom, fitZoom, formatZoom, zoomIn, zoomOut } from '../../core/zoom';
import { deleteShots, getShot, updateShot } from '../../shared/db';
import { applyI18n, t } from '../../shared/i18n';
import { icons, type IconName } from '../../shared/icons';
import { loadSettings, saveSettings } from '../../shared/settingsStore';
import type { ShotRecord } from '../../shared/types';
import { $, applyIcons, bindMenu, isMac, openReport } from '../../shared/ui';
import { loadSource } from '../../render/exportShot';
import { fontFor, layoutFor, measureText, renderDoc, renderThumb, type RenderSource } from '../../render/renderDoc';
import { copyShot, printShot, saveShot } from '../shared/shotActions';
import { shortcutGroups } from './shortcutList';

applyI18n();
applyIcons();

const MAC = isMac();
const MARGIN = 40;
const HANDLE = 8; // 핸들 크기(화면 px)
// 붓은 펜과 같아서 뺐다 (PR #1 요청). 예전에 만든 붓 개체는 그대로 보이고 고칠 수 있다
const TOOL_ORDER: (ToolId | '|')[] = ['select', 'crop', '|', 'rect', 'ellipse', 'arrow', 'line', 'text', 'highlighter', 'blur', 'badge', '|', 'pen'];
const TOOL_KEY: Record<ToolId, string> = {
  select: 'V', crop: 'C', rect: 'R', ellipse: 'O', arrow: 'A', line: 'L', text: 'T', highlighter: 'H', blur: 'B', badge: 'N', pen: 'P', brush: 'M',
};
const FORMAT_LABEL: Record<FileFormat, string> = { png: 'PNG', jpg: 'JPG', pdf: 'PDF' };

// ---- 상태 ----
let shot: ShotRecord;
let src: RenderSource & { image: ImageBitmap };
let history: History<EditorDoc>;
/** 끌기 중의 임시 문서. 손을 떼면 이력에 넣는다 */
let draft: EditorDoc | null = null;
let tool: ToolId = 'select';
/** 마지막에 고른 개체. 핸들과 스타일 패널은 이 개체 기준 */
let selected: string | null = null;
/** Shift로 함께 고른 나머지 개체 (PR #1 요청) */
const extraSel = new Set<string>();
let zoom = EDITOR_INITIAL_ZOOM;
let zoomBeforeCrop = zoom;
let cropRect: Rect | null = null;
let objectClipboard: EditorObject[] = [];
let editingText: { id: string; isNew: boolean } | null = null;
let lastMove: { key: string; at: number } | null = null;
let fileFormat: FileFormat = 'png';
const toolStyles: Record<ObjectType, ToolStyle> = structuredClone(DEFAULT_TOOL_STYLES);

type Drag =
  | { kind: 'create'; id: string; type: ObjectType; x0: number; y0: number; sx: number; sy: number }
  | { kind: 'draw'; id: string }
  | { kind: 'move'; ids: string[]; x0: number; y0: number; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; x0: number; y0: number; start: EditorObject }
  | { kind: 'crop-new'; x0: number; y0: number }
  | { kind: 'crop-move'; x0: number; y0: number; start: Rect }
  | { kind: 'crop-handle'; handle: Handle; x0: number; y0: number; start: Rect };
let drag: Drag | null = null;

const stage = $('#stage');
const sizer = $('#sizer');
const canvas = $('#view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const textInput = $('#text-input') as HTMLTextAreaElement;

const doc = (): EditorDoc => draft ?? history.present;
const objectById = (id: string | null) => doc().objects.find((o) => o.id === id) ?? null;

/** 고른 개체 전부의 id (마지막에 고른 것이 끝) */
function selectedIds(): string[] {
  const ids = [...extraSel].filter((id) => objectById(id));
  if (selected && objectById(selected)) ids.push(selected);
  return ids;
}

function selectOnly(id: string | null): void {
  selected = id;
  extraSel.clear();
}

/** Shift로 누르면 고르기/빼기를 바꾼다 */
function toggleSelect(id: string): void {
  if (id === selected) {
    const rest = [...extraSel];
    selected = rest.pop() ?? null;
    if (selected) extraSel.delete(selected);
  } else if (extraSel.has(id)) {
    extraSel.delete(id);
  } else {
    if (selected) extraSel.add(selected);
    selected = id;
  }
}

// ---- 좌표 변환 ----
function view() {
  const L = layoutFor(src, doc(), { fullImage: tool === 'crop' });
  const cw = stage.clientWidth;
  const ch = stage.clientHeight;
  const contentW = L.width * zoom;
  const contentH = L.height * zoom;
  const sw = Math.max(cw, contentW + MARGIN * 2);
  const sh = Math.max(ch, contentH + MARGIN * 2);
  return { L, cw, ch, sw, sh, ox: (sw - contentW) / 2 - stage.scrollLeft, oy: (sh - contentH) / 2 - stage.scrollTop };
}

/** 화면(캔버스) 좌표 → 원본 이미지 좌표 */
function toDoc(px: number, py: number): [number, number] {
  const v = view();
  return [(px - v.ox) / zoom + v.L.crop.x, (py - v.oy) / zoom - v.L.imageY + v.L.crop.y];
}

/** 원본 이미지 좌표 → 화면 좌표 */
function toScreen(x: number, y: number): [number, number] {
  const v = view();
  return [v.ox + (x - v.L.crop.x) * zoom, v.oy + (y - v.L.crop.y + v.L.imageY) * zoom];
}

// ---- 그리기 ----
let renderQueued = false;
function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render(): void {
  if (!history) return; // 아직 스크린샷을 불러오는 중
  const v = view();
  sizer.style.width = `${v.sw}px`;
  sizer.style.height = `${v.sh}px`;
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(v.cw * dpr) || canvas.height !== Math.round(v.ch * dpr)) {
    canvas.width = Math.round(v.cw * dpr);
    canvas.height = Math.round(v.ch * dpr);
    canvas.style.width = `${v.cw}px`;
    canvas.style.height = `${v.ch}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.cw, v.ch);

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(zoom, zoom);
  ctx.shadowColor = 'rgba(20,30,50,0.18)';
  ctx.shadowBlur = 16 / zoom;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, v.L.width, v.L.height);
  ctx.shadowColor = 'transparent';
  ctx.imageSmoothingQuality = 'high';
  renderDoc(ctx, src, doc(), {
    fullImage: tool === 'crop',
    hidden: editingText ? new Set([editingText.id]) : undefined,
    visible: { x: -v.ox / zoom, y: -v.oy / zoom, w: v.cw / zoom, h: v.ch / zoom },
  });
  ctx.restore();

  if (tool === 'crop' && cropRect) drawCropOverlay(v);
  else drawSelection();
}

function drawHandle(x: number, y: number): void {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#2b6cde';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
  ctx.strokeRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
}

function screenRect(r: Rect): Rect {
  const [x, y] = toScreen(r.x, r.y);
  return { x, y, w: r.w * zoom, h: r.h * zoom };
}

function drawSelection(): void {
  if (editingText) return;
  const ids = selectedIds();
  if (ids.length > 1) {
    // 여러 개를 골랐을 때는 테두리만 보여 준다(크기 조절은 하나만 골랐을 때)
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#2b6cde';
    ctx.lineWidth = 1.5;
    for (const id of ids) {
      const r = screenRect(boundsOf(objectById(id)!));
      ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    }
    ctx.restore();
    return;
  }
  const o = objectById(selected);
  if (!o) return;
  ctx.save();
  if (o.type === 'arrow' || o.type === 'line') {
    const [x1, y1] = toScreen(o.x1, o.y1);
    const [x2, y2] = toScreen(o.x2, o.y2);
    drawHandle(x1, y1);
    drawHandle(x2, y2);
  } else {
    const r = screenRect(boundsOf(o));
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#2b6cde';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    ctx.setLineDash([]);
    for (const h of handlesFor(o)) {
      const [hx, hy] = handlePosition(boundsOf(o), h);
      const [sx, sy] = toScreen(hx, hy);
      drawHandle(sx, sy);
    }
  }
  ctx.restore();
}

function drawCropOverlay(v: ReturnType<typeof view>): void {
  const r = screenRect(cropRect!);
  const img = { x: v.ox, y: v.oy, w: v.L.width * zoom, h: v.L.height * zoom };
  ctx.save();
  ctx.fillStyle = 'rgba(15,20,30,0.5)';
  ctx.beginPath();
  ctx.rect(img.x, img.y, img.w, img.h);
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  // 3분할 격자선
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const f of [1 / 3, 2 / 3]) {
    ctx.moveTo(r.x + r.w * f, r.y);
    ctx.lineTo(r.x + r.w * f, r.y + r.h);
    ctx.moveTo(r.x, r.y + r.h * f);
    ctx.lineTo(r.x + r.w, r.y + r.h * f);
  }
  ctx.stroke();
  for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[]) {
    const [hx, hy] = handlePosition(cropRect!, h);
    const [sx, sy] = toScreen(hx, hy);
    drawHandle(sx, sy);
  }
  // 자를 영역 크기 표시
  const label = `${Math.round(cropRect!.w)} x ${Math.round(cropRect!.h)}`;
  ctx.font = '12px system-ui, sans-serif';
  const tw = ctx.measureText(label).width + 12;
  ctx.fillStyle = 'rgba(15,20,30,0.8)';
  ctx.fillRect(r.x + 6, r.y + 6, tw, 22);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + 12, r.y + 17);
  ctx.restore();
}

// ---- 이력과 저장 ----
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 300);
}

async function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  shot = { ...shot, doc: history.present };
  await updateShot(shot.id, { doc: history.present });
}

/** 편집기를 떠날 때 목록 썸네일에도 편집 내용을 반영한다 */
let thumbDoc: EditorDoc | null = null;
async function updateThumb(): Promise<void> {
  if (!history || thumbDoc === history.present) return;
  thumbDoc = history.present;
  await updateShot(shot.id, { thumb: await renderThumb(src, history.present) });
}

function commit(next: EditorDoc): void {
  draft = null;
  if (next === history.present) {
    refresh();
    return;
  }
  history.push(next);
  lastMove = null;
  scheduleSave();
  refresh();
}

function refresh(): void {
  if (!history) return;
  ($('#undo-btn') as HTMLButtonElement).disabled = !history.canUndo;
  ($('#redo-btn') as HTMLButtonElement).disabled = !history.canRedo;
  $('#undo-btn').title = `${t.editor.undo} (${MAC ? '⌘' : 'Ctrl+'}Z)`;
  $('#redo-btn').title = `${t.editor.redo} (${MAC ? '⌘' : 'Ctrl+'}Y)`;
  if (selected && !objectById(selected)) selected = null;
  for (const id of [...extraSel]) if (!objectById(id)) extraSel.delete(id);
  $('#zoom-label').textContent = formatZoom(zoom);
  renderObjects();
  renderStylePanel();
  renderStatus();
  renderMoreMenu();
  requestRender();
}

// ---- 도구 ----
function setTool(next: ToolId): void {
  // 자르는 중에 자르기를 다시 고르면 조절 중인 영역과 원래 비율을 잃지 않게 그대로 둔다
  if (tool === 'crop' && next === 'crop' && cropRect) return;
  finishTextEdit();
  if (tool === 'crop' && next !== 'crop') exitCrop(false);
  tool = next;
  if (next === 'crop') {
    selectOnly(null);
    cropRect = doc().crop ?? { x: 0, y: 0, w: shot.width, h: shot.height };
    zoomBeforeCrop = zoom;
    // 자르기 화면에서는 전체가 보이게 비율을 맞춘다 (EDT-02)
    setZoom(fitZoom(shot.width, shot.height, stage.clientWidth - MARGIN * 2, stage.clientHeight - MARGIN * 2 - 60));
    $('#crop-bar').hidden = false;
  }
  document.querySelectorAll<HTMLElement>('#toolbar [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  refresh();
}

function exitCrop(apply: boolean): void {
  if (apply && cropRect) {
    const r = clampCrop(cropRect, shot.width, shot.height);
    const full = r && r.x === 0 && r.y === 0 && r.w === shot.width && r.h === shot.height;
    const next = { ...history.present, crop: full ? null : r ?? history.present.crop };
    cropRect = null;
    $('#crop-bar').hidden = true;
    tool = 'select';
    setZoom(zoomBeforeCrop);
    commit(next);
    setTool('select');
    return;
  }
  cropRect = null;
  $('#crop-bar').hidden = true;
  if (tool === 'crop') {
    tool = 'select';
    setZoom(zoomBeforeCrop);
    setTool('select');
  }
}

function buildToolbar(): void {
  const bar = $('#toolbar');
  for (const id of TOOL_ORDER) {
    if (id === '|') {
      bar.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
      continue;
    }
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.dataset.tool = id;
    b.innerHTML = icons[id as IconName];
    b.title = `${t.editor.tools[id]} (${TOOL_KEY[id]})`;
    b.setAttribute('aria-label', t.editor.tools[id]);
    b.addEventListener('click', () => setTool(id));
    bar.appendChild(b);
  }
  bar.insertAdjacentHTML('beforeend', '<div class="spacer"></div>');
  const report = document.createElement('button');
  report.className = 'icon-btn';
  report.innerHTML = icons.flag;
  report.title = t.common.report;
  report.addEventListener('click', openReport);
  bar.appendChild(report);
}

// ---- 마우스 / 펜 입력 ----
function canvasPoint(e: PointerEvent | MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function handleAt(px: number, py: number, rect: Rect, handles: Handle[]): Handle | null {
  for (const h of handles) {
    const [hx, hy] = handlePosition(rect, h);
    const [sx, sy] = toScreen(hx, hy);
    if (Math.abs(px - sx) <= HANDLE && Math.abs(py - sy) <= HANDLE) return h;
  }
  return null;
}

function objectHandleAt(px: number, py: number): Handle | null {
  const o = objectById(selected);
  if (!o || extraSel.size > 0) return null;
  if (o.type === 'arrow' || o.type === 'line') {
    for (const [h, x, y] of [['p1', o.x1, o.y1], ['p2', o.x2, o.y2]] as const) {
      const [sx, sy] = toScreen(x, y);
      if (Math.abs(px - sx) <= HANDLE && Math.abs(py - sy) <= HANDLE) return h;
    }
    return null;
  }
  return handleAt(px, py, boundsOf(o), handlesFor(o));
}

const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move' };

function updateHoverCursor(px: number, py: number): void {
  if (tool === 'crop' && cropRect) {
    const h = handleAt(px, py, cropRect, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    canvas.style.cursor = h ? CURSORS[h] : 'crosshair';
  } else if (tool === 'select') {
    const h = objectHandleAt(px, py);
    if (h) canvas.style.cursor = CURSORS[h];
    else {
      const [x, y] = toDoc(px, py);
      canvas.style.cursor = hitTest(doc().objects, x, y, HIT_TOLERANCE_PX / zoom) ? 'move' : 'default';
    }
  }
}

function styleFor(type: ObjectType): ToolStyle {
  return toolStyles[type];
}

function newObject(type: ObjectType, x: number, y: number): EditorObject {
  const s = styleFor(type);
  const id = newObjectId();
  switch (type) {
    case 'rect':
      return { id, type, x, y, w: 0, h: 0, color: s.color, width: s.width, fill: s.fill, radius: s.radius };
    case 'ellipse':
      return { id, type, x, y, w: 0, h: 0, color: s.color, width: s.width, fill: s.fill };
    case 'blur':
      return { id, type, x, y, w: 0, h: 0, strength: s.strength, mode: s.mode };
    case 'arrow':
      return { id, type, x1: x, y1: y, x2: x, y2: y, color: s.color, width: s.width, heads: s.heads };
    case 'line':
      return { id, type, x1: x, y1: y, x2: x, y2: y, color: s.color, width: s.width };
    case 'highlighter':
      return { id, type, points: [x, y], color: s.color, width: HIGHLIGHTER_WIDTH };
    case 'pen':
    case 'brush':
      return { id, type, points: [x, y], color: s.color, width: s.width };
    case 'text': {
      const m = measureText('', s.fontSize);
      return { id, type, x, y, w: m.w, h: m.h, text: '', color: s.color, fill: s.fill, fontSize: s.fontSize };
    }
    case 'badge': {
      const size = defaultBadgeSize(shot.width, shot.height);
      return { id, type, x: x - size / 2, y: y - size / 2, w: size, h: size, color: s.color, number: 0 };
    }
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !history) return;
  // 기본 동작(포커스 이동)을 막아야 새로 연 글자 입력칸이 바로 입력을 받는다
  e.preventDefault();
  finishTextEdit();
  const [px, py] = canvasPoint(e);
  const [x, y] = toDoc(px, py);
  canvas.setPointerCapture(e.pointerId);

  if (tool === 'crop') {
    const r = cropRect!;
    const h = handleAt(px, py, r, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    if (h) drag = { kind: 'crop-handle', handle: h, x0: x, y0: y, start: r };
    else if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) drag = { kind: 'crop-move', x0: x, y0: y, start: r };
    else drag = { kind: 'crop-new', x0: x, y0: y };
    return;
  }

  if (tool === 'select') {
    const h = objectHandleAt(px, py);
    const sel = objectById(selected);
    if (h && sel) {
      drag = { kind: 'resize', id: sel.id, handle: h, x0: x, y0: y, start: sel };
      return;
    }
    const hit = hitTest(doc().objects, x, y, HIT_TOLERANCE_PX / zoom);
    if (e.shiftKey && hit) {
      toggleSelect(hit);
      refresh();
      return;
    }
    // 이미 고른 묶음 안을 누르면 묶음 그대로 옮긴다
    if (!hit || !selectedIds().includes(hit)) selectOnly(hit);
    if (hit) drag = { kind: 'move', ids: selectedIds(), x0: x, y0: y, moved: false };
    refresh();
    return;
  }

  const type = tool as ObjectType;
  if (type === 'badge') {
    const o = newObject('badge', x, y);
    commit(addBadge(history.present, { x: (o as { x: number }).x, y: (o as { y: number }).y, w: (o as { w: number }).w, h: (o as { h: number }).h }, styleFor('badge').color, o.id));
    selectOnly(o.id);
    refresh();
    return;
  }
  if (type === 'text') {
    const hit = hitTest(doc().objects.filter((o) => o.type === 'text'), x, y, 0);
    if (hit) {
      selectOnly(hit);
      startTextEdit(hit, false);
      return;
    }
    const o = newObject('text', x, y);
    draft = addObject(history.present, o);
    selectOnly(o.id);
    startTextEdit(o.id, true);
    return;
  }
  const o = newObject(type, x, y);
  draft = addObject(history.present, o);
  selectOnly(o.id);
  drag = type === 'pen' || type === 'brush' || type === 'highlighter' ? { kind: 'draw', id: o.id } : { kind: 'create', id: o.id, type, x0: x, y0: y, sx: px, sy: py };
  requestRender();
});

canvas.addEventListener('pointermove', (e) => {
  const [px, py] = canvasPoint(e);
  if (!drag) {
    updateHoverCursor(px, py);
    return;
  }
  const [x, y] = toDoc(px, py);
  const base = history.present;
  switch (drag.kind) {
    case 'create': {
      const isLine = drag.type === 'arrow' || drag.type === 'line';
      // Shift: 정사각형·정원, 수평·수직 직선 (PR #1 요청)
      const end = !e.shiftKey ? { x, y } : isLine ? snapStraight(drag.x0, drag.y0, x, y) : constrainSquare(drag.x0, drag.y0, x, y);
      const patch = isLine ? { x2: end.x, y2: end.y } : normalizeRect({ x: drag.x0, y: drag.y0, w: end.x - drag.x0, h: end.y - drag.y0 });
      draft = updateObject(draft ?? base, drag.id, patch);
      break;
    }
    case 'draw': {
      const o = objectById(drag.id);
      if (o && 'points' in o) {
        const p = o.points;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= 1.5 / zoom) draft = updateObject(draft ?? base, drag.id, { points: [...p, x, y] });
      }
      break;
    }
    case 'move':
      drag.moved = true;
      draft = moveObjects(base, drag.ids, x - drag.x0, y - drag.y0);
      break;
    case 'resize':
      draft = updateObject(base, drag.id, resizeObject(drag.start, drag.handle, x - drag.x0, y - drag.y0));
      break;
    case 'crop-new':
      cropRect = normalizeRect({ x: drag.x0, y: drag.y0, w: x - drag.x0, h: y - drag.y0 });
      break;
    case 'crop-move': {
      const s = drag.start;
      const nx = Math.min(Math.max(0, s.x + x - drag.x0), shot.width - s.w);
      const ny = Math.min(Math.max(0, s.y + y - drag.y0), shot.height - s.h);
      cropRect = { ...s, x: nx, y: ny };
      break;
    }
    case 'crop-handle': {
      const r = normalizeRect(drag.start);
      let { x: x0, y: y0 } = r;
      let x1 = r.x + r.w;
      let y1 = r.y + r.h;
      const h = drag.handle;
      if (h.includes('w')) x0 = Math.min(Math.max(0, x), shot.width);
      if (h.includes('e')) x1 = Math.min(Math.max(0, x), shot.width);
      if (h.startsWith('n')) y0 = Math.min(Math.max(0, y), shot.height);
      if (h.startsWith('s')) y1 = Math.min(Math.max(0, y), shot.height);
      cropRect = normalizeRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      break;
    }
  }
  requestRender();
});

function endDrag(): void {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === 'crop-new' || d.kind === 'crop-move' || d.kind === 'crop-handle') {
    // 너무 작거나 이미지 밖이면 이전 영역으로 되돌린다
    const fixed = cropRect ? clampCrop(cropRect, shot.width, shot.height) : null;
    cropRect = fixed ?? (d.kind === 'crop-new' ? history.present.crop ?? { x: 0, y: 0, w: shot.width, h: shot.height } : d.start);
    requestRender();
    return;
  }
  if (d.kind === 'move' && !d.moved) {
    draft = null;
    return;
  }
  if (d.kind === 'create') {
    const o = objectById(d.id);
    const b = o ? boundsOf(o) : null;
    // 클릭만 하고 끌지 않았으면 만들지 않는다
    if (!b || (b.w * zoom < 3 && b.h * zoom < 3)) {
      draft = null;
      selectOnly(null);
      refresh();
      return;
    }
  }
  if (draft) commit(draft);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('dblclick', (e) => {
  if (tool !== 'select') return;
  const [x, y] = toDoc(...canvasPoint(e));
  const hit = hitTest(doc().objects, x, y, HIT_TOLERANCE_PX / zoom);
  // TODO(미확인): 글자를 고치는 방법을 모른다. 텍스트 개체를 두 번 누르면 고친다
  if (hit && objectById(hit)?.type === 'text') startTextEdit(hit, false);
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const [px, py] = canvasPoint(e);
      setZoom(clampZoom(zoom * Math.exp(-e.deltaY * 0.002)), [px, py]);
    } else {
      stage.scrollBy(e.deltaX, e.deltaY);
    }
  },
  { passive: false },
);
stage.addEventListener('scroll', requestRender);
new ResizeObserver(requestRender).observe(stage);

// ---- 텍스트 입력 ----
function startTextEdit(id: string, isNew: boolean): void {
  const o = objectById(id);
  if (!o || o.type !== 'text') return;
  editingText = { id, isNew };
  const [sx, sy] = toScreen(o.x, o.y);
  const pad = o.fontSize * 0.25 * zoom;
  textInput.hidden = false;
  textInput.value = o.text;
  textInput.placeholder = t.editor.textPlaceholder;
  Object.assign(textInput.style, {
    left: `${sx}px`,
    top: `${sy}px`,
    padding: `${pad}px`,
    font: fontFor(o.fontSize * zoom),
    color: o.color,
    background: o.fill ?? 'rgba(255,255,255,0.6)',
  });
  sizeTextInput();
  requestRender();
  textInput.focus();
}

function sizeTextInput(): void {
  const o = objectById(editingText?.id ?? null);
  if (!o || o.type !== 'text') return;
  const m = measureText(textInput.value || t.editor.textPlaceholder, o.fontSize);
  textInput.style.width = `${m.w * zoom + 4}px`;
  textInput.style.height = `${m.h * zoom + 4}px`;
}

function finishTextEdit(): void {
  if (!editingText) return;
  const { id, isNew } = editingText;
  editingText = null;
  textInput.hidden = true;
  const o = objectById(id);
  const text = textInput.value.replace(/\s+$/, '');
  if (!o || o.type !== 'text') return;
  if (!text) {
    // 빈 글자는 남기지 않는다
    draft = null;
    if (!isNew) commit(removeObject(history.present, id));
    selectOnly(null);
    refresh();
    return;
  }
  const m = measureText(text, o.fontSize);
  const base = isNew ? draft ?? history.present : history.present;
  commit(updateObject(base, id, { text, w: m.w, h: m.h }));
}

textInput.addEventListener('input', sizeTextInput);
textInput.addEventListener('blur', () => finishTextEdit());
textInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    textInput.blur();
  }
});

// ---- 확대 / 축소 ----
function setZoom(z: number, anchor?: [number, number]): void {
  const v = view();
  const [ax, ay] = anchor ?? [v.cw / 2, v.ch / 2];
  const outX = (ax - v.ox) / zoom;
  const outY = (ay - v.oy) / zoom;
  zoom = clampZoom(z);
  const nv = view();
  sizer.style.width = `${nv.sw}px`;
  sizer.style.height = `${nv.sh}px`;
  const contentW = nv.L.width * zoom;
  const contentH = nv.L.height * zoom;
  stage.scrollLeft = (nv.sw - contentW) / 2 + outX * zoom - ax;
  stage.scrollTop = (nv.sh - contentH) / 2 + outY * zoom - ay;
  $('#zoom-label').textContent = formatZoom(zoom);
  if (editingText) finishTextEdit();
  requestRender();
}

function fitToScreen(): void {
  const L = layoutFor(src, doc(), { fullImage: tool === 'crop' });
  setZoom(fitZoom(L.width, L.height, stage.clientWidth - MARGIN * 2, stage.clientHeight - MARGIN * 2));
}

// ---- 오른쪽 패널: 스타일 ----
function swatchRow(current: string | null, allowNone: boolean, onPick: (v: string | null) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'swatches';
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.title = t.editor.panel.custom;
  const isPalette = PALETTE.some((p) => p.value === current);
  if (current && !isPalette) custom.classList.add('selected');
  const input = document.createElement('input');
  input.type = 'color';
  input.value = current && current.startsWith('#') && current.length === 7 ? current : '#000000';
  input.addEventListener('change', () => onPick(input.value));
  custom.appendChild(input);
  row.appendChild(custom);
  if (allowNone) {
    const none = document.createElement('button');
    none.className = 'swatch none' + (current === null ? ' selected' : '');
    none.title = t.editor.panel.none;
    none.addEventListener('click', () => onPick(null));
    row.appendChild(none);
  }
  for (const p of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch' + (p.value === current ? ' selected' : '');
    b.style.background = p.value;
    b.title = t.editor.colors[p.id];
    b.addEventListener('click', () => onPick(p.value));
    row.appendChild(b);
  }
  return row;
}

function field(label: string, control: HTMLElement, value?: string): HTMLElement {
  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = `<div class="label"><span></span><span class="value"></span></div>`;
  f.querySelector('.label span')!.textContent = label;
  if (value !== undefined) f.querySelector('.value')!.textContent = value;
  f.appendChild(control);
  return f;
}

function slider(key: LimitKey, value: number, onInput: (v: number) => void, onChange: (v: number) => void): HTMLInputElement {
  const s = document.createElement('input');
  s.type = 'range';
  s.min = String(LIMITS[key].min);
  s.max = String(LIMITS[key].max);
  s.step = '1';
  s.value = String(value);
  s.addEventListener('input', () => onInput(clampValue(key, Number(s.value))));
  s.addEventListener('change', () => onChange(clampValue(key, Number(s.value))));
  return s;
}

function toggle(options: [string, string][], current: string, onPick: (v: string) => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'toggle';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = value === current ? 'on' : '';
    b.addEventListener('click', () => onPick(value));
    box.appendChild(b);
  }
  return box;
}

/** 고른 개체가 있으면 그 개체를, 없으면 지금 도구의 다음 스타일을 바꾼다 */
function applyStyle(type: ObjectType | null, patch: Partial<ToolStyle>, final: boolean): void {
  const ids = selectedIds();
  if (ids.length > 1) {
    // 여러 개를 골랐으면 색만 함께 바꾼다 (PR #1 답변 E ①)
    if (patch.color === undefined) return;
    let next = history.present;
    for (const id of ids) {
      const obj = objectById(id);
      if (obj && 'color' in obj) next = updateObject(next, id, { color: patch.color } as Partial<EditorObject>);
    }
    commit(next);
    return;
  }
  if (!type) return;
  Object.assign(toolStyles[type], patch);
  const o = objectById(selected);
  if (!o || o.type !== type) {
    if (final) renderStylePanel();
    return;
  }
  const objPatch: Record<string, unknown> = {};
  if (patch.color !== undefined) objPatch.color = patch.color;
  if (patch.fill !== undefined) objPatch.fill = patch.fill;
  if (patch.width !== undefined) objPatch.width = patch.width;
  if (patch.radius !== undefined) objPatch.radius = patch.radius;
  if (patch.heads !== undefined) objPatch.heads = patch.heads;
  if (patch.strength !== undefined) objPatch.strength = patch.strength;
  if (patch.mode !== undefined) objPatch.mode = patch.mode;
  if (patch.fontSize !== undefined && o.type === 'text') {
    const m = measureText(o.text, patch.fontSize);
    Object.assign(objPatch, { fontSize: patch.fontSize, w: m.w, h: m.h });
  }
  const next = updateObject(history.present, o.id, objPatch as Partial<EditorObject>);
  if (final) commit(next);
  else {
    draft = next;
    requestRender();
  }
}

function renderStylePanel(): void {
  const panel = $('#style-panel');
  panel.textContent = '';
  const ids = selectedIds();
  if (ids.length > 1) {
    const h = document.createElement('h3');
    h.textContent = t.editor.multiSelected(ids.length);
    panel.appendChild(h);
    const first = ids.map(objectById).find((x) => x && 'color' in x) as { color: string } | undefined;
    panel.appendChild(field(t.editor.panel.color, swatchRow(first?.color ?? null, false, (v) => applyStyle(null, { color: v! }, true))));
    return;
  }
  const o = objectById(selected);
  const type: ObjectType | null = o ? o.type : tool !== 'select' && tool !== 'crop' ? (tool as ObjectType) : null;
  if (!type) {
    panel.innerHTML = `<p class="hint"></p>`;
    panel.querySelector('.hint')!.textContent = t.editor.panel.noSelection;
    return;
  }
  const s = o ? { ...toolStyles[type], ...(o as unknown as Partial<ToolStyle>) } : toolStyles[type];
  const P = t.editor.panel;
  const h = document.createElement('h3');
  h.textContent = o ? objectName(o) : t.editor.tools[type];
  panel.appendChild(h);
  const set = (patch: Partial<ToolStyle>, final = true) => applyStyle(type, patch, final);

  if (type !== 'blur') panel.appendChild(field(P.color, swatchRow(s.color, false, (v) => set({ color: v! }))));
  if (type === 'rect' || type === 'ellipse' || type === 'text') panel.appendChild(field(P.fill, swatchRow(s.fill, true, (v) => set({ fill: v }))));
  const widthKey: LimitKey | null = type === 'brush' ? 'brush' : ['rect', 'ellipse', 'arrow', 'line', 'pen'].includes(type) ? 'stroke' : null;
  if (widthKey) {
    const f = field(P.thickness, document.createElement('span'), `${s.width}px`);
    f.lastElementChild!.replaceWith(slider(widthKey, s.width, (v) => { f.querySelector('.value')!.textContent = `${v}px`; set({ width: v }, false); }, (v) => set({ width: v })));
    panel.appendChild(f);
  }
  if (type === 'rect') {
    const f = field(P.radius, document.createElement('span'), `${s.radius}px`);
    f.lastElementChild!.replaceWith(slider('radius', s.radius, (v) => { f.querySelector('.value')!.textContent = `${v}px`; set({ radius: v }, false); }, (v) => set({ radius: v })));
    panel.appendChild(f);
  }
  if (type === 'text') {
    const f = field(P.fontSize, document.createElement('span'), `${s.fontSize}px`);
    f.lastElementChild!.replaceWith(slider('fontSize', s.fontSize, (v) => { f.querySelector('.value')!.textContent = `${v}px`; set({ fontSize: v }, false); }, (v) => set({ fontSize: v })));
    panel.appendChild(f);
  }
  if (type === 'arrow') panel.appendChild(field(P.heads, toggle([['one', P.headsOne], ['both', P.headsBoth]], s.heads, (v) => set({ heads: v as 'one' | 'both' }))));
  if (type === 'blur') {
    const f = field(P.strength, document.createElement('span'), `${s.strength}px`);
    f.lastElementChild!.replaceWith(slider('blur', s.strength, (v) => { f.querySelector('.value')!.textContent = `${v}px`; set({ strength: v }, false); }, (v) => set({ strength: v })));
    panel.appendChild(f);
    panel.appendChild(field(P.mode, toggle([['blur', P.modeBlur], ['mosaic', P.modeMosaic]], s.mode, (v) => set({ mode: v as 'blur' | 'mosaic' }))));
  }
}

// ---- 오른쪽 패널: 개체 목록 (EDT-10) ----
function objectName(o: EditorObject): string {
  const n = t.editor.objectName;
  return o.type === 'badge' ? n.badge(o.number) : n[o.type];
}

function objectColor(o: EditorObject): string {
  return 'color' in o ? o.color : '#9aa3ae';
}

function renderObjects(): void {
  const objs = doc().objects;
  // "개체"는 왼쪽, 개수는 오른쪽 (PR #1 요청)
  $('#objects-label').textContent = t.editor.objectsLabel;
  $('#objects-count').textContent = String(objs.length);
  const ids = new Set(selectedIds());
  $('#objects-empty').hidden = objs.length > 0;
  const list = $('#objects-list');
  list.textContent = '';
  // 나중에 만든(위에 있는) 개체가 목록 위쪽에 온다
  [...objs].reverse().forEach((o) => {
    const li = document.createElement('li');
    li.className = ids.has(o.id) ? 'selected' : '';
    li.innerHTML = `${icons[o.type as IconName]}<span class="name"></span>`;
    li.querySelector('.name')!.textContent = objectName(o);
    if (o.id === selected && ids.size === 1) {
      const mk = (icon: IconName, title: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'icon-btn';
        b.innerHTML = icons[icon];
        b.title = title;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
        li.appendChild(b);
      };
      mk('up', t.editor.bringForward, () => commit(moveLayer(history.present, o.id, 1)));
      mk('down', t.editor.sendBackward, () => commit(moveLayer(history.present, o.id, -1)));
      mk('close', t.editor.deleteObject, () => commit(removeObject(history.present, o.id)));
    } else {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = objectColor(o);
      li.appendChild(dot);
    }
    // TODO(미확인): 목록의 줄을 누르면 무슨 일이 일어나는지 모른다. 그 개체를 고른다
    // Shift를 누르고 누르면 여러 개를 고른다 (PR #1 요청)
    li.addEventListener('click', (e) => {
      if (tool !== 'select') setTool('select');
      if (e.shiftKey) toggleSelect(o.id);
      else selectOnly(o.id);
      refresh();
    });
    list.appendChild(li);
  });
}

function renderStatus(): void {
  const L = layoutFor(src, doc());
  $('#status').textContent = t.editor.status(L.width, L.height, doc().objects.length);
  $('#page-url').textContent = shot.url;
  $('#page-url').title = shot.url;
}

// ---- 더보기 메뉴: 주소·날짜 도장 (EXP-06) ----
let lastStampPosition: Exclude<StampPosition, 'none'> = 'top';

function setStamp(position: StampPosition, dateFormat: StampDateFormat): void {
  if (position !== 'none') lastStampPosition = position;
  commit({ ...history.present, stamp: { position, dateFormat } });
  // TODO(미확인): 다음 촬영에도 유지하는지 모른다. 마지막 선택을 설정에 저장해 다음 촬영에 쓴다
  void saveSettings({ stampPosition: position, stampDateFormat: dateFormat });
}

function renderMoreMenu(): void {
  const { position, dateFormat } = doc().stamp;
  const mk = (box: HTMLElement, items: [string, string][], current: string, disabled: boolean, pick: (v: string) => void) => {
    box.textContent = '';
    for (const [value, label] of items) {
      const b = document.createElement('button');
      b.disabled = disabled;
      b.innerHTML = `<span class="check">${value === current ? icons.check : ''}</span><span></span>`;
      b.lastElementChild!.textContent = label;
      b.addEventListener('click', () => pick(value));
      box.appendChild(b);
    }
  };
  const P = t.editor.stampPositions;
  const D = t.editor.dateFormats;
  mk($('#stamp-positions'), [['none', P.none], ['top', P.top], ['bottom', P.bottom], ['mac', P.mac], ['windows', P.windows]], position, false, (v) => setStamp(v as StampPosition, dateFormat));
  // "표시 안 함"일 때는 날짜 형식을 고를 수 없다
  mk($('#date-formats'), [['date', D.date], ['datetime', D.datetime], ['iso', D.iso], ['none', D.none]], dateFormat, position === 'none', (v) => setStamp(position, v as StampDateFormat));
}

// ---- 단축키 창 ----
function openShortcuts(): void {
  const grid = $('#shortcut-grid');
  grid.textContent = '';
  for (const g of shortcutGroups(MAC)) {
    const col = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = g.title;
    col.appendChild(h);
    for (const item of g.items) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      label.textContent = item.label;
      const keys = document.createElement('span');
      if (typeof item.keys === 'string') keys.textContent = item.keys;
      else
        item.keys.forEach((combo, i) => {
          if (i > 0) keys.append(` ${t.shortcuts.or} `);
          combo.forEach((k, j) => {
            if (j > 0) keys.append(' + ');
            const kbd = document.createElement('kbd');
            kbd.textContent = k;
            keys.appendChild(kbd);
          });
        });
      row.append(label, keys);
      col.appendChild(row);
    }
    grid.appendChild(col);
  }
  $('#shortcuts-dialog').hidden = false;
}

$('#shortcuts-close').addEventListener('click', () => ($('#shortcuts-dialog').hidden = true));
$('#shortcuts-dialog').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('#shortcuts-dialog').hidden = true;
});

// ---- 저장 / 복사 / 인쇄 ----
async function currentShot(): Promise<ShotRecord> {
  finishTextEdit();
  await flushSave();
  return shot;
}

async function doExport(format: FileFormat, ask = false): Promise<void> {
  await saveShot(await currentShot(), format, ask);
}

// ---- 키보드 (EDT-15) ----
function runAction(a: EditorAction): boolean {
  const ids = selectedIds();
  const sels = ids.map((id) => objectById(id)!).filter(Boolean);
  switch (a.type) {
    case 'tool':
      setTool(a.tool);
      return true;
    case 'undo':
    case 'redo': {
      if (tool === 'crop') exitCrop(false);
      const r = a.type === 'undo' ? history.undo() : history.redo();
      if (r) {
        lastMove = null;
        scheduleSave();
        refresh();
      }
      return true;
    }
    case 'duplicate':
    case 'paste': {
      const sources = a.type === 'duplicate' ? sels : objectClipboard;
      if (sources.length === 0) return a.type === 'duplicate';
      const r = cloneManyInto(history.present, sources);
      if (a.type === 'paste') objectClipboard = r.ids.map((id) => r.doc.objects.find((o) => o.id === id)!);
      selectOnly(r.ids[r.ids.length - 1]);
      r.ids.slice(0, -1).forEach((id) => extraSel.add(id));
      commit(r.doc);
      return true;
    }
    case 'copyObject':
      if (sels.length === 0) return false; // 고른 개체가 없으면 브라우저 기본 복사에 맡긴다
      objectClipboard = structuredClone(sels);
      return true;
    case 'delete':
      if (sels.length === 0) return false;
      commit(removeObjects(history.present, ids));
      return true;
    case 'enter': {
      const wasCrop = tool === 'crop';
      if (wasCrop) exitCrop(true);
      return wasCrop;
    }
    case 'escape':
      if (!$('#shortcuts-dialog').hidden) $('#shortcuts-dialog').hidden = true;
      else if (tool === 'crop') exitCrop(false);
      else if (tool !== 'select') {
        // 그리기 도구를 쓰다가 Esc → 선택 도구로 (PR #1 요청)
        selectOnly(null);
        setTool('select');
      } else {
        selectOnly(null);
        refresh();
      }
      return true;
    case 'move': {
      if (sels.length === 0) return false;
      const next = moveObjects(history.present, ids, a.dx, a.dy);
      const key = ids.join(',');
      // 연달아 누른 화살표 키는 실행 취소 한 번에 되돌아가도록 묶는다
      if (lastMove && lastMove.key === key && Date.now() - lastMove.at < 800) {
        history.replace(next);
        scheduleSave();
        refresh();
      } else commit(next);
      lastMove = { key, at: Date.now() };
      return true;
    }
    case 'export':
      void doExport(fileFormat);
      return true;
    case 'exportAs':
      void doExport(fileFormat, true);
      return true;
    case 'copyImage':
      void currentShot().then(copyShot);
      return true;
    case 'stampToggle': {
      const { position, dateFormat } = history.present.stamp;
      setStamp(position === 'none' ? lastStampPosition : 'none', dateFormat);
      return true;
    }
    case 'zoomIn':
      setZoom(zoomIn(zoom));
      return true;
    case 'zoomOut':
      setZoom(zoomOut(zoom));
      return true;
    case 'help':
      openShortcuts();
      return true;
  }
}

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.matches('input, textarea, select') || e.isComposing) return;
  // 마우스로 끄는 중에는 단축키를 받지 않는다(끄던 임시 상태가 실행 취소 등을 덮어쓰지 않게)
  if (drag) {
    e.preventDefault();
    return;
  }
  const action = resolveShortcut(e, MAC);
  if (!action) return;
  if (runAction(action)) e.preventDefault();
});

// ---- 시작 ----
async function deleteCurrent(): Promise<void> {
  if (!confirm(t.result.deleteConfirm)) return; // TODO(추정): 결과 화면 휴지통과 같은 확인 창
  await deleteShots([shot.id]);
  location.replace('gallery.html');
}

async function goBack(): Promise<void> {
  finishTextEdit();
  await flushSave();
  await updateThumb();
  if (document.referrer.includes('result.html') && window.history.length > 1) window.history.back();
  else location.replace(`result.html?id=${shot.id}`);
}

async function main(): Promise<void> {
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const found = await getShot(id);
  if (!found) {
    document.body.innerHTML = `<p style="padding:40px"></p>`;
    document.body.firstElementChild!.textContent = t.result.notFound;
    return;
  }
  shot = found;
  src = await loadSource(shot);
  history = new History(shot.doc);
  if (shot.doc.stamp.position !== 'none') lastStampPosition = shot.doc.stamp.position;
  document.title = `${t.editor.title} - ${shot.title || t.common.untitled}`;

  const settings = await loadSettings();
  fileFormat = settings.fileFormat;
  $('#save-label').textContent = fileFormat === 'pdf' ? t.result.savePdf : t.result.saveAs(FORMAT_LABEL[fileFormat]);
  $('#m-png').textContent = t.result.saveAs('PNG');
  $('#m-jpg').textContent = t.result.saveAs('JPG');

  buildToolbar();
  setTool('select');
  setZoom(EDITOR_INITIAL_ZOOM);
  stage.scrollLeft = 0;
  stage.scrollTop = 0;
  refresh();

  $('#back-btn').addEventListener('click', () => void goBack());
  $('#undo-btn').addEventListener('click', () => runAction({ type: 'undo' }));
  $('#redo-btn').addEventListener('click', () => runAction({ type: 'redo' }));
  $('#zoom-in').addEventListener('click', () => setZoom(zoomIn(zoom)));
  $('#zoom-out').addEventListener('click', () => setZoom(zoomOut(zoom)));
  $('#zoom-fit').addEventListener('click', fitToScreen);
  $('#zoom-in').title = `${t.common.zoomIn} (Z)`;
  $('#zoom-out').title = `${t.common.zoomOut} (${MAC ? '⌥' : 'Alt+'}Z)`;
  $('#copy-btn').addEventListener('click', () => void currentShot().then(copyShot));
  $('#print-btn').addEventListener('click', () => void currentShot().then(printShot));
  $('#save-btn').addEventListener('click', () => void doExport(fileFormat));
  $('#crop-apply').addEventListener('click', () => exitCrop(true));
  $('#crop-cancel').addEventListener('click', () => exitCrop(false));
  const saveMenu = $('#save-menu');
  bindMenu($('#save-more'), saveMenu);
  saveMenu.querySelectorAll<HTMLButtonElement>('button[data-format]').forEach((b) =>
    b.addEventListener('click', () => {
      saveMenu.hidden = true;
      void doExport(b.dataset.format as FileFormat);
    }),
  );
  const moreMenu = $('#more-menu');
  bindMenu($('#more-btn'), moreMenu);
  $('#shortcuts-item').addEventListener('click', () => {
    moreMenu.hidden = true;
    openShortcuts();
  });
  $('#report-item').addEventListener('click', () => {
    moreMenu.hidden = true;
    openReport();
  });
  $('#delete-item').addEventListener('click', () => {
    moreMenu.hidden = true;
    void deleteCurrent();
  });
  window.addEventListener('pagehide', () => void flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave().then(updateThumb);
  });
  thumbDoc = history.present;
}

void main();
