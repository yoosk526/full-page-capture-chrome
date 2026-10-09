// 펜·형광펜 선 부드럽게 보정 (PR #1 세 번째 요청). 손떨림처럼 들쭉날쭉한 점을 이웃 점의 평균으로 다듬는다.

/** 앞뒤로 이만큼의 점을 함께 평균한다. TODO(추정): 보정 세기는 임의로 정했다 */
export const SMOOTH_RADIUS = 3;

/**
 * 점 목록 [x0, y0, x1, y1, ...]을 부드럽게 다듬은 새 목록을 돌려준다.
 * 시작점과 끝점은 그대로 두고, 가운데 점은 가까운 점일수록 크게 치는 가중 평균으로 옮긴다.
 * 끝 근처는 평균 범위를 줄여 선이 짧아지지 않게 한다.
 */
export function smoothStroke(points: readonly number[], radius: number = SMOOTH_RADIUS): number[] {
  const n = Math.floor(points.length / 2);
  if (n < 3 || radius < 1) return points.slice();
  const out = points.slice();
  for (let i = 1; i < n - 1; i++) {
    const r = Math.min(radius, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let k = -r; k <= r; k++) {
      const w = r + 1 - Math.abs(k);
      sx += points[(i + k) * 2] * w;
      sy += points[(i + k) * 2 + 1] * w;
      sw += w;
    }
    out[i * 2] = sx / sw;
    out[i * 2 + 1] = sy / sw;
  }
  return out;
}
