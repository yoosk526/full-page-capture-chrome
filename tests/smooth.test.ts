import { describe, expect, it } from 'vitest';
import { smoothStroke } from '../src/core/smooth';

/** 점 목록에서 직선 y = 0으로부터 가장 먼 거리 */
const maxDev = (p: number[]) => Math.max(...p.filter((_, i) => i % 2 === 1).map(Math.abs));

describe('smoothStroke: 펜·형광펜 선 보정 (PR #1 세 번째 요청)', () => {
  // 목적: 점이 2개(가장 짧은 선)일 때 선이 사라지거나 바뀌는 결함을 막는다
  it('[BVA] TC-SMOOTH-01 점 2개(보정 최소 3개 - 1) → 그대로', () => {
    expect(smoothStroke([0, 0, 10, 5])).toEqual([0, 0, 10, 5]);
  });

  // 목적: 보정할 수 있는 가장 짧은 선(점 3개)에서 가운데 점이 보정되지 않는 결함을 막는다
  it('[BVA] TC-SMOOTH-02 점 3개(최소) → 끝점은 그대로, 가운데 점은 이웃 쪽으로 당겨짐', () => {
    const r = smoothStroke([0, 0, 10, 10, 20, 0]);
    expect([r[0], r[1], r[4], r[5]]).toEqual([0, 0, 20, 0]);
    expect(r[3]).toBeLessThan(10);
  });

  // 목적: 손떨림처럼 위아래로 흔들린 선이 보정 뒤에도 그대로 들쭉날쭉한 결함을 막는다
  it('[EP] TC-SMOOTH-03 위아래로 ±4px 흔들린 가로선 → 흔들림이 절반 이하로 줄어듦', () => {
    const zig = Array.from({ length: 20 }, (_, i) => [i * 5, i % 2 ? 4 : -4]).flat();
    zig[1] = 0;
    zig[zig.length - 1] = 0;
    expect(maxDev(smoothStroke(zig).slice(8, -8))).toBeLessThanOrEqual(2);
  });

  // 목적: 이미 곧은 선을 보정하다 휘게 만드는 결함을 막는다
  it('[EP] TC-SMOOTH-04 곧은 선 → 그대로 곧음', () => {
    const line = Array.from({ length: 10 }, (_, i) => [i * 10, i * 5]).flat();
    const r = smoothStroke(line);
    for (let i = 0; i < r.length; i += 2) expect(r[i + 1]).toBeCloseTo(r[i] / 2, 6);
  });
});
