// 자르기 영역 보정 (EDT-02)
import type { Rect } from './doc';

/** 자르기 영역의 최소 크기(px). TODO(미확인): 기존 프로그램의 최소 크기는 모름 */
export const CROP_MIN = 10;

/** 거꾸로 끈 사각형(폭·높이가 음수)을 바로 세운다 */
export function normalizeRect(r: Rect): Rect {
  const x = r.w < 0 ? r.x + r.w : r.x;
  const y = r.h < 0 ? r.y + r.h : r.y;
  return { x, y, w: Math.abs(r.w), h: Math.abs(r.h) };
}

/**
 * 자르기 영역을 이미지 안으로 맞추고 정수 픽셀로 만든다.
 * TODO(미확인): 핸들을 이미지 바깥으로 끌면 이미지 경계에서 멈추게 했다.
 * @returns 남는 영역이 최소 크기보다 작으면(완전히 밖, 폭/높이 0 등) null
 */
export function clampCrop(r: Rect, imageW: number, imageH: number, min: number = CROP_MIN): Rect | null {
  const n = normalizeRect(r);
  const x0 = Math.max(0, Math.round(n.x));
  const y0 = Math.max(0, Math.round(n.y));
  const x1 = Math.min(imageW, Math.round(n.x + n.w));
  const y1 = Math.min(imageH, Math.round(n.y + n.h));
  if (x1 - x0 < min || y1 - y0 < min) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
