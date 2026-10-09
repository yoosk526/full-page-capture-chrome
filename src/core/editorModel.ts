// 편집기 개체 조작 (EDT-01 ~ EDT-17). 모든 함수는 문서를 바꾸지 않고 새 문서를 돌려준다.
import type { EditorDoc, EditorObject, ObjectType, PathObj, Rect } from './doc';
import { normalizeRect } from './crop';

// ---- 색 목록 (모든 도구 공통 7가지, 채우기는 "없음"을 더한 8가지) ----
export const PALETTE = [
  { id: 'black', value: '#1e293b' }, // 짙은 남색에 가까운 검정
  { id: 'red', value: '#ff0000' }, // PR #1 요청: 기본 빨강은 #FF0000
  { id: 'yellow', value: '#f5c518' },
  { id: 'green', value: '#30a46c' },
  { id: 'slate', value: '#64748b' },
  { id: 'white', value: '#ffffff' },
] as const;

// ---- 숫자 항목의 범위. TODO(미확인): 기존 프로그램의 최소·최대·단위는 모름 (docs/OPEN_QUESTIONS.md) ----
export const LIMITS = {
  stroke: { min: 1, max: 20 }, // 사각형, 타원, 화살표, 선, 펜의 두께
  brush: { min: 1, max: 20 },
  blur: { min: 1, max: 30 },
  radius: { min: 0, max: 50 },
  fontSize: { min: 8, max: 120 },
} as const;
export type LimitKey = keyof typeof LIMITS;

/** 형광펜은 두께 항목이 없다(EDT-17). TODO(추정): 굵기는 고정값 */
export const HIGHLIGHTER_WIDTH = 20;
/** 복제·붙여넣기할 때 원본에서 비켜 놓는 거리. TODO(추정) */
export const DUPLICATE_OFFSET = 20;
/** 클릭으로 개체를 고를 때 허용하는 거리(화면 px) */
export const HIT_TOLERANCE_PX = 6;

/** 슬라이더 값을 범위 안의 정수로 맞춘다 */
export function clampValue(key: LimitKey, value: number): number {
  const { min, max } = LIMITS[key];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 도구별 처음 스타일 (FEATURES.md의 관찰값) */
export interface ToolStyle {
  color: string;
  width: number;
  fill: string | null;
  radius: number;
  heads: 'one' | 'both';
  fontSize: number;
  strength: number;
  mode: 'blur' | 'mosaic';
}

const c = (id: (typeof PALETTE)[number]['id']) => PALETTE.find((p) => p.id === id)!.value;

export const DEFAULT_TOOL_STYLES: Record<ObjectType, ToolStyle> = {
  rect: { color: c('yellow'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  ellipse: { color: c('red'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  arrow: { color: c('red'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  line: { color: c('black'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  text: { color: c('red'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  highlighter: { color: c('yellow'), width: HIGHLIGHTER_WIDTH, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  blur: { color: c('black'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  badge: { color: c('black'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  pen: { color: c('white'), width: 4, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
  brush: { color: c('white'), width: 3, fill: null, radius: 0, heads: 'one', fontSize: 24, strength: 6, mode: 'blur' },
};

let idSeq = 0;
export function newObjectId(): string {
  idSeq += 1;
  return `o${Date.now().toString(36)}${idSeq.toString(36)}`;
}

// ---- 문서 조작 ----

export function addObject(doc: EditorDoc, obj: EditorObject): EditorDoc {
  return { ...doc, objects: [...doc.objects, obj] };
}

/**
 * 번호 표시를 만든다 (EDT-06). 만들 때마다 번호가 1씩 올라간다.
 * TODO(미확인): 배지를 지웠을 때 번호를 다시 매기는지 모른다. 지금은 다시 매기지 않는다.
 */
export function addBadge(doc: EditorDoc, rect: Rect, color: string, id: string = newObjectId()): EditorDoc {
  const number = doc.badgeCounter + 1;
  return { ...addObject(doc, { id, type: 'badge', ...rect, color, number }), badgeCounter: number };
}

/** 번호 표시의 처음 크기: 이미지 짧은 변의 약 1/10 (EDT-06 관찰). TODO(추정) */
export function defaultBadgeSize(imageW: number, imageH: number): number {
  return Math.min(200, Math.max(24, Math.round(Math.min(imageW, imageH) / 10)));
}

export function updateObject(doc: EditorDoc, id: string, patch: Partial<EditorObject>): EditorDoc {
  return {
    ...doc,
    objects: doc.objects.map((o) => (o.id === id ? ({ ...o, ...patch, id: o.id, type: o.type } as EditorObject) : o)),
  };
}

export function removeObject(doc: EditorDoc, id: string): EditorDoc {
  return { ...doc, objects: doc.objects.filter((o) => o.id !== id) };
}

/** 겹침 순서를 한 칸 옮긴다. +1 = 앞으로(위로), -1 = 뒤로. 끝에 있으면 그대로 */
export function moveLayer(doc: EditorDoc, id: string, dir: 1 | -1): EditorDoc {
  const i = doc.objects.findIndex((o) => o.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.objects.length) return doc;
  const objects = [...doc.objects];
  [objects[i], objects[j]] = [objects[j], objects[i]];
  return { ...doc, objects };
}

export function translateObject(o: EditorObject, dx: number, dy: number): EditorObject {
  switch (o.type) {
    case 'arrow':
    case 'line':
      return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    case 'highlighter':
    case 'pen':
    case 'brush':
      return { ...o, points: o.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
    default:
      return { ...o, x: o.x + dx, y: o.y + dy };
  }
}

export function moveObject(doc: EditorDoc, id: string, dx: number, dy: number): EditorDoc {
  return { ...doc, objects: doc.objects.map((o) => (o.id === id ? translateObject(o, dx, dy) : o)) };
}

/**
 * 개체를 복제(또는 붙여넣기)한다. 새 개체는 맨 위에 놓이고 조금 비켜 놓인다.
 * 번호 표시는 새 번호를 받는다(만들 때마다 번호가 올라가는 규칙, EDT-06).
 */
export function cloneInto(doc: EditorDoc, source: EditorObject, offset = DUPLICATE_OFFSET, id = newObjectId()): EditorDoc {
  const moved = translateObject(structuredClone(source), offset, offset);
  if (moved.type === 'badge') {
    const number = doc.badgeCounter + 1;
    return { ...addObject(doc, { ...moved, id, number }), badgeCounter: number };
  }
  return addObject(doc, { ...moved, id });
}

// ---- 여러 개를 함께 다루기 (PR #1 요청: Shift로 여러 개 선택) ----

export function removeObjects(doc: EditorDoc, ids: Iterable<string>): EditorDoc {
  const set = new Set(ids);
  return { ...doc, objects: doc.objects.filter((o) => !set.has(o.id)) };
}

export function moveObjects(doc: EditorDoc, ids: Iterable<string>, dx: number, dy: number): EditorDoc {
  const set = new Set(ids);
  return { ...doc, objects: doc.objects.map((o) => (set.has(o.id) ? translateObject(o, dx, dy) : o)) };
}

/** 여러 개를 한꺼번에 복제한다. 원래 겹침 순서대로 맨 위에 놓인다. 새 id 목록도 돌려준다 */
export function cloneManyInto(doc: EditorDoc, sources: EditorObject[], offset = DUPLICATE_OFFSET): { doc: EditorDoc; ids: string[] } {
  const order = new Map(doc.objects.map((o, i) => [o.id, i]));
  const sorted = [...sources].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  let next = doc;
  const ids: string[] = [];
  for (const src of sorted) {
    next = cloneInto(next, src, offset);
    ids.push(next.objects[next.objects.length - 1].id);
  }
  return { doc: next, ids };
}

// ---- 위치와 크기 ----

/** 개체를 감싸는 사각형 (원본 이미지 좌표) */
export function boundsOf(o: EditorObject): Rect {
  switch (o.type) {
    case 'arrow':
    case 'line':
      return normalizeRect({ x: o.x1, y: o.y1, w: o.x2 - o.x1, h: o.y2 - o.y1 });
    case 'highlighter':
    case 'pen':
    case 'brush': {
      const xs = o.points.filter((_, i) => i % 2 === 0);
      const ys = o.points.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    default:
      return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hits(o: EditorObject, x: number, y: number, tol: number): boolean {
  switch (o.type) {
    case 'arrow':
    case 'line':
      return distToSegment(x, y, o.x1, o.y1, o.x2, o.y2) <= o.width / 2 + tol;
    case 'highlighter':
    case 'pen':
    case 'brush': {
      const p = o.points;
      if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= o.width / 2 + tol;
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= o.width / 2 + tol) return true;
      }
      return false;
    }
    default: {
      const b = boundsOf(o);
      return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    }
  }
}

/** 그 위치에서 맨 위에 있는 개체의 id. tol은 원본 이미지 좌표 기준 허용 거리 */
export function hitTest(objects: EditorObject[], x: number, y: number, tol: number): string | null {
  for (let i = objects.length - 1; i >= 0; i--) if (hits(objects[i], x, y, tol)) return objects[i].id;
  return null;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2';
export const BOX_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 개체 종류별 크기 조절 핸들. 텍스트는 글자 크기로만 조절한다 */
export function handlesFor(o: EditorObject): Handle[] {
  if (o.type === 'arrow' || o.type === 'line') return ['p1', 'p2'];
  if (o.type === 'text') return [];
  if (o.type === 'badge') return ['nw', 'ne', 'se', 'sw'];
  return BOX_HANDLES;
}

export function handlePosition(r: Rect, h: Handle): [number, number] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const map: Record<string, [number, number]> = {
    nw: [r.x, r.y],
    n: [cx, r.y],
    ne: [r.x + r.w, r.y],
    e: [r.x + r.w, cy],
    se: [r.x + r.w, r.y + r.h],
    s: [cx, r.y + r.h],
    sw: [r.x, r.y + r.h],
    w: [r.x, cy],
  };
  return map[h];
}

/** 사각형 핸들을 (dx, dy)만큼 끌었을 때의 새 사각형. 반대편을 넘어가면 뒤집어 바로 세운다 */
export function resizeRect(r: Rect, h: Handle, dx: number, dy: number): Rect {
  let { x, y, w, h: hh } = r;
  if (h.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (h.includes('e')) w += dx;
  if (h.startsWith('n')) {
    y += dy;
    hh -= dy;
  }
  if (h.startsWith('s')) hh += dy;
  return normalizeRect({ x, y, w, h: hh });
}

/** 핸들 끌기를 개체에 적용한다 (start는 끌기 시작 때의 개체) */
export function resizeObject(start: EditorObject, h: Handle, dx: number, dy: number): EditorObject {
  switch (start.type) {
    case 'arrow':
    case 'line':
      return h === 'p1'
        ? { ...start, x1: start.x1 + dx, y1: start.y1 + dy }
        : { ...start, x2: start.x2 + dx, y2: start.y2 + dy };
    case 'highlighter':
    case 'pen':
    case 'brush': {
      const b = boundsOf(start);
      const nb = resizeRect(b, h, dx, dy);
      return scalePath(start, b, nb);
    }
    case 'badge': {
      // 정사각형을 유지한다
      const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      const sign = h === 'nw' || h === 'se' ? 1 : -1;
      const r = resizeRect(start, h, d, d * sign);
      const size = Math.max(8, Math.max(r.w, r.h));
      return { ...start, ...r, w: size, h: size };
    }
    case 'text':
      return start;
    default:
      return { ...start, ...resizeRect(start, h, dx, dy) };
  }
}

function scalePath(o: PathObj, from: Rect, to: Rect): PathObj {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return {
    ...o,
    points: o.points.map((v, i) => (i % 2 === 0 ? to.x + (v - from.x) * sx : to.y + (v - from.y) * sy)),
  };
}

/** 문서에 편집 내용이 있는지 (편집하지 않았으면 원본 PNG를 그대로 쓴다) */
export function hasEdits(doc: EditorDoc | undefined): boolean {
  return !!doc && (doc.objects.length > 0 || doc.crop !== null || doc.stamp.position !== 'none');
}
