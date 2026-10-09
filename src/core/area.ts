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
