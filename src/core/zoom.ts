// 확대/축소 비율 계산 (RES-03, EDT-12)

/** TODO(미확인): 기존 프로그램의 최소·최대 비율과 단계는 모른다. 관찰값(24.3%, 27%, 36.0%, 75%)을 포함하도록 정했다. */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4;
export const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** 편집기에 들어갈 때의 비율 (EDT-12 관찰값) */
export const EDITOR_INITIAL_ZOOM = 0.75;

const EPS = 1e-9;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** 현재 비율보다 한 단계 큰 값. 이미 최대면 최대 그대로 */
export function zoomIn(current: number): number {
  const next = ZOOM_STEPS.find((s) => s > current + EPS);
  return next ?? ZOOM_MAX;
}

/** 현재 비율보다 한 단계 작은 값. 이미 최소면 최소 그대로 */
export function zoomOut(current: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < current - EPS) return ZOOM_STEPS[i];
  }
  return ZOOM_MIN;
}

/** 이미지 전체가 상자 안에 들어오는 비율. 100%보다 키우지는 않는다 */
export function fitZoom(imageW: number, imageH: number, boxW: number, boxH: number): number {
  if (imageW <= 0 || imageH <= 0 || boxW <= 0 || boxH <= 0) return 1;
  return clampZoom(Math.min(boxW / imageW, boxH / imageH, 1));
}

/** "75%", "24.3%"처럼 표시한다. 소수 첫째 자리가 0이면 정수로 */
export function formatZoom(z: number): string {
  const pct = Math.round(z * 1000) / 10;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}
