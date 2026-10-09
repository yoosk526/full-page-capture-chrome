// captureVisibleTab 호출 간격 제어
//
// Chrome API 스키마(tabs.json)의 MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2
// → 호출 사이를 최소 500ms 띄워야 한다. 타이머 오차를 생각해 50ms 여유를 둔다.
export const MAX_CAPTURE_CALLS_PER_SECOND = 2;
export const CAPTURE_INTERVAL_MS = Math.ceil(1000 / MAX_CAPTURE_CALLS_PER_SECOND) + 50;

/**
 * 다음 호출 전에 기다려야 하는 시간(ms).
 * @param lastCallAt 직전 호출 시각(ms). 아직 호출한 적이 없으면 null
 */
export function delayBeforeNextCall(lastCallAt: number | null, now: number, intervalMs: number = CAPTURE_INTERVAL_MS): number {
  if (lastCallAt === null) return 0;
  const elapsed = now - lastCallAt;
  return Math.max(0, intervalMs - elapsed);
}
