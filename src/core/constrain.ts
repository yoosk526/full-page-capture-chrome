// Shift를 누르고 그릴 때의 보정 (PR #1 요청)
// - 사각형·타원·가리기: 가로·세로가 같은 정사각형·정원
// - 선·화살표: 수평 또는 수직의 반듯한 직선

/** 끝점을 옮겨 가로·세로 길이를 더 긴 쪽에 맞춘다. 끄는 방향(부호)은 유지한다 */
export function constrainSquare(x0: number, y0: number, x: number, y: number): { x: number; y: number } {
  const dx = x - x0;
  const dy = y - y0;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: x0 + (dx < 0 ? -size : size), y: y0 + (dy < 0 ? -size : size) };
}

/** 끝점을 수평선 또는 수직선 위로 옮긴다. 가로로 더 많이 움직였으면 수평, 같으면 수평 */
export function snapStraight(x0: number, y0: number, x: number, y: number): { x: number; y: number } {
  return Math.abs(x - x0) >= Math.abs(y - y0) ? { x, y: y0 } : { x: x0, y };
}

/** 형광펜 그리기 방식 (Issue #6): 직선 = 누른 곳에서 뗀 곳까지 곧은 선, 자유 = 마우스가 지나간 대로 */
export type HighlighterMode = 'straight' | 'free';

/**
 * 끄는 중 새 위치(x, y)를 받아 선의 점 목록을 고친다.
 * - 직선: 시작점과 지금 위치 두 점만 둔다. Shift를 누르면 수평·수직으로 맞춘다.
 * - 자유: 마지막 점에서 minStep 이상 움직였을 때만 점을 더한다.
 * @returns 바뀔 것이 없으면 null
 */
export function extendStroke(
  points: readonly number[],
  x: number,
  y: number,
  mode: HighlighterMode,
  shift: boolean,
  minStep: number,
): number[] | null {
  const x0 = points[0];
  const y0 = points[1];
  if (mode === 'straight') {
    const end = shift ? snapStraight(x0, y0, x, y) : { x, y };
    return [x0, y0, end.x, end.y];
  }
  const lx = points[points.length - 2];
  const ly = points[points.length - 1];
  if (Math.hypot(x - lx, y - ly) < minStep) return null;
  return [...points, x, y];
}
