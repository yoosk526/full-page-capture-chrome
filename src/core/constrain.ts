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
