// "페이지 일부" 촬영 (PR #1 요청, 답변 B ②: 마우스로 영역을 끌어서 찍기)
import { normalizeRect } from './crop';
import type { Rect } from './doc';

/** 이보다 작게 끌면(클릭에 가까우면) 찍지 않는다 (CSS px). TODO(추정) */
export const AREA_MIN_CSS = 4;

/**
 * 화면에서 끈 영역(CSS px)을 찍힌 이미지의 픽셀 영역으로 바꾼다.
 * 거꾸로 끈 영역은 바로 세우고, 화면 밖으로 나간 부분은 잘라 낸다.
 * @returns 너무 작으면 null
 */
export function areaToPixels(rect: Rect, scale: number, imageW: number, imageH: number, min: number = AREA_MIN_CSS): Rect | null {
  const r = normalizeRect(rect);
  if (r.w < min || r.h < min) return null;
  const x0 = Math.max(0, Math.round(r.x * scale));
  const y0 = Math.max(0, Math.round(r.y * scale));
  const x1 = Math.min(imageW, Math.round((r.x + r.w) * scale));
  const y1 = Math.min(imageH, Math.round((r.y + r.h) * scale));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 화면 위·아래 끝에서 이만큼 안쪽부터 자동 스크롤이 시작된다 (CSS px, Q43 답변 ②). TODO(추정) */
export const AUTO_SCROLL_EDGE = 40;
/** 끝을 이만큼 넘게 당기면 가장 빠르게 스크롤한다 (CSS px). TODO(추정) */
export const AUTO_SCROLL_RANGE = 160;
/** 가장 빠른 자동 스크롤 (화면 한 번 그릴 때마다 CSS px). TODO(추정) */
export const AUTO_SCROLL_MAX = 60;

/**
 * 영역을 끄는 중 마우스 위치에 따른 자동 스크롤 양(한 번 그릴 때마다). 위로는 음수, 아래로는 양수.
 * 끝에 가까울수록, 끝을 넘어 많이 당길수록 빠르다.
 */
export function autoScrollStep(
  pointerY: number,
  viewportH: number,
  edge: number = AUTO_SCROLL_EDGE,
  range: number = AUTO_SCROLL_RANGE,
  max: number = AUTO_SCROLL_MAX,
): number {
  const up = edge - pointerY;
  const down = pointerY - (viewportH - edge);
  const depth = Math.max(up, down);
  if (depth <= 0) return 0;
  const speed = Math.max(1, Math.round((Math.min(depth, range) / range) * max));
  return up > down ? -speed : speed;
}

/**
 * 고른 영역에서 아직 안 찍은 부분 [covered, bottom)을 찍으려면 어디로 스크롤할지.
 * 위치는 스크롤을 더한 값이고, 화면에서 내용이 보이는 구간은 [viewTop, viewBottom)이다
 * (창 스크롤이면 화면 전체, 스크롤 상자면 그 상자가 차지한 구간).
 * 남은 부분이 지금 다 보이면 움직이지 않는다.
 */
export function areaScrollTarget(covered: number, bottom: number, current: number, viewTop: number, viewBottom: number, maxScroll: number): number {
  if (covered - current >= viewTop && bottom - current <= viewBottom) return current;
  // 소수점 위치로 스크롤하면 브라우저가 반올림해 남은 부분의 시작이 화면 위로 밀려날 수 있어 내림한다 (Issue #3)
  return Math.max(0, Math.floor(Math.min(covered - viewTop, maxScroll)));
}

/** 스크롤 위치가 반올림 등으로 이만큼(CSS px) 어긋나는 것은 같은 위치로 본다 (Issue #3). TODO(추정) */
export const AREA_SNAP_TOLERANCE = 1;

/**
 * 실제 스크롤 위치(actual)에서 찍은 화면 중 영역에 붙일 세로 구간(화면 기준 CSS px).
 * @returns 붙일 것이 없으면(스크롤이 생각대로 안 됨) null
 */
export function areaChunk(
  covered: number,
  bottom: number,
  actual: number,
  viewTop: number,
  viewBottom: number,
  tolerance: number = AREA_SNAP_TOLERANCE,
): { srcY: number; height: number } | null {
  const want = covered - actual;
  // 반올림으로 생긴 아주 작은 어긋남은 보이는 구간 맨 위부터 붙인다 (그 차이만큼은 잃는다)
  if (want < viewTop - tolerance) return null;
  const srcY = Math.max(want, viewTop);
  const end = Math.min(viewBottom, bottom - actual);
  if (end - srcY <= 0) return null;
  return { srcY, height: end - srcY };
}
