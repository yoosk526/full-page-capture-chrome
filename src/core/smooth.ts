// 펜·형광펜 선 부드럽게 보정 (PR #1 세 번째 요청). 손떨림처럼 들쭉날쭉한 점을 이웃 점의 평균으로 다듬는다.
// 일부러 꺾은 곳(뾰족한 모서리)은 그대로 남긴다 (PR #1 네 번째 요청).

/** 앞뒤로 이만큼의 점을 함께 평균한다. TODO(추정): 보정 세기는 임의로 정했다 (Q45 답변 ①: 지금대로) */
export const SMOOTH_RADIUS = 3;
/** 앞뒤로 이 길이(px)만큼 떨어진 점을 보고 꺾인 정도를 잰다. 손떨림처럼 짧은 흔들림은 꺾임으로 보지 않는다. TODO(추정) */
export const CORNER_SPAN = 12;
/** 진행 방향이 이 각도(도) 이상 바뀌면 일부러 꺾은 모서리로 본다. TODO(추정) */
export const CORNER_ANGLE = 60;

const px = (p: readonly number[], i: number) => p[i * 2];
const py = (p: readonly number[], i: number) => p[i * 2 + 1];
const dist = (p: readonly number[], i: number, j: number) => Math.hypot(px(p, j) - px(p, i), py(p, j) - py(p, i));

/** 일부러 꺾은 모서리의 점 번호 (작은 것부터) */
export function findCorners(points: readonly number[], span: number = CORNER_SPAN, angle: number = CORNER_ANGLE): number[] {
  const n = Math.floor(points.length / 2);
  const turn: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    // 선을 따라 span만큼 앞뒤로 간 점
    let j = i;
    for (let len = 0; j > 0 && len < span; j--) len += dist(points, j - 1, j);
    let k = i;
    for (let len = 0; k < n - 1 && len < span; k++) len += dist(points, k, k + 1);
    const ax = px(points, i) - px(points, j);
    const ay = py(points, i) - py(points, j);
    const bx = px(points, k) - px(points, i);
    const by = py(points, k) - py(points, i);
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
    turn[i] = (Math.acos(cos) * 180) / Math.PI;
  }
  // 꺾임이 큰 점이 이어진 구간마다 가장 많이 꺾인 점 하나만 고른다
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (turn[i] < angle) continue;
    let best = i;
    while (i + 1 < n - 1 && turn[i + 1] >= angle) {
      i++;
      if (turn[i] > turn[best]) best = i;
    }
    out.push(best);
  }
  return out;
}

/** 시작점과 끝점은 그대로 두고 가운데 점을 가까운 점일수록 크게 치는 가중 평균으로 옮긴다 */
function averageSegment(points: readonly number[], from: number, to: number, radius: number, out: number[]): void {
  for (let i = from + 1; i < to; i++) {
    const r = Math.min(radius, i - from, to - i);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let k = -r; k <= r; k++) {
      const w = r + 1 - Math.abs(k);
      sx += px(points, i + k) * w;
      sy += py(points, i + k) * w;
      sw += w;
    }
    out[i * 2] = sx / sw;
    out[i * 2 + 1] = sy / sw;
  }
}

/**
 * 점 목록 [x0, y0, x1, y1, ...]을 부드럽게 다듬은 새 목록을 돌려준다.
 * 시작점·끝점과 일부러 꺾은 모서리는 그대로 두고, 그 사이 구간만 다듬는다.
 */
export function smoothStroke(points: readonly number[], radius: number = SMOOTH_RADIUS): number[] {
  const n = Math.floor(points.length / 2);
  if (n < 3 || radius < 1) return points.slice();
  const out = points.slice();
  const stops = [0, ...findCorners(points), n - 1];
  for (let s = 0; s + 1 < stops.length; s++) averageSegment(points, stops[s], stops[s + 1], radius, out);
  return out;
}
