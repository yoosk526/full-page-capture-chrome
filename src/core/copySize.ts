// 클립보드 복사본 축소 (EXP-04, SET-16)

/** 이 픽셀 수를 넘으면 줄인다 (기존 프로그램 설정 문구의 기준값) */
export const COPY_PIXEL_LIMIT = 25_000_000;

/** 줄여야 하는지: 설정이 켜져 있고 픽셀 수가 한도를 "넘을" 때만 */
export function needsShrink(width: number, height: number, enabled: boolean, limit = COPY_PIXEL_LIMIT): boolean {
  return enabled && width * height > limit;
}

/**
 * 가로세로 비율을 유지하며 픽셀 수가 한도 이하가 되는 가장 큰 크기.
 * TODO(미확인): 기존 프로그램이 줄이는 목표 크기는 모른다. 한도에 딱 맞게 줄인다.
 */
export function shrinkSize(width: number, height: number, limit = COPY_PIXEL_LIMIT): { width: number; height: number } {
  const s = Math.sqrt(limit / (width * height));
  let w = Math.max(1, Math.floor(width * s));
  let h = Math.max(1, Math.floor(height * s));
  // 부동소수 오차로 한도를 넘는 일을 막는다
  while (w * h > limit) {
    if (w >= h) w -= 1;
    else h -= 1;
  }
  return { width: w, height: h };
}
