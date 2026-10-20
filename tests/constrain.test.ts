import { describe, expect, it } from 'vitest';
import { constrainSquare, extendStroke, snapStraight } from '../src/core/constrain';

describe('constrainSquare: Shift + 사각형·타원 (PR #1 요청)', () => {
  // 목적: Shift를 눌러도 직사각형이 그려지는 결함을 막는다
  it('[EP] TC-SHIFT-01 오른쪽 아래로 (100, 40) 끌기 → (100, 100) 정사각형', () => {
    expect(constrainSquare(0, 0, 100, 40)).toEqual({ x: 100, y: 100 });
  });

  // 목적: 왼쪽 위로 거꾸로 끌 때 방향이 뒤집히는 결함을 막는다
  it('[EP] TC-SHIFT-02 왼쪽 위로 (-30, -80) 끌기 → (-80, -80), 끄는 방향 유지', () => {
    expect(constrainSquare(0, 0, -30, -80)).toEqual({ x: -80, y: -80 });
  });
});

describe('snapStraight: Shift + 선·화살표 (PR #1 요청)', () => {
  // 목적: 가로로 더 많이 끌었는데 수직선이 되는 결함을 막는다
  it('[BVA] TC-SHIFT-03 가로 이동 = 세로 이동+1 → 수평선', () => {
    expect(snapStraight(0, 0, 51, 50)).toEqual({ x: 51, y: 0 });
  });

  // 목적: 정확히 45도일 때 결과가 흔들리는(수평·수직이 번갈아 나오는) 결함을 막는다
  it('[BVA] TC-SHIFT-04 가로 이동 = 세로 이동(45도) → 수평선으로 정함', () => {
    expect(snapStraight(0, 0, 50, 50)).toEqual({ x: 50, y: 0 });
  });

  // 목적: 세로로 더 많이 끌었는데 수평선이 되는 결함을 막는다
  it('[BVA] TC-SHIFT-05 세로 이동 = 가로 이동+1 → 수직선', () => {
    expect(snapStraight(10, 10, 60, 61)).toEqual({ x: 10, y: 61 });
  });
});

describe('extendStroke: 형광펜 직선/자유 그리기 (Issue #6)', () => {
  // 목적: 직선 모드인데 마우스가 지나간 점이 쌓여 삐뚤빼뚤한 선이 되는 결함을 막는다
  it('[EP] TC-HLM-01 직선 모드, 이미 여러 점 → 시작점과 지금 위치 두 점만', () => {
    expect(extendStroke([0, 0, 5, 3, 9, 1], 40, 6, 'straight', false, 1.5)).toEqual([0, 0, 40, 6]);
  });

  // 목적: 직선 모드에서 Shift를 눌러도 수평으로 맞춰지지 않는 결함을 막는다
  it('[EP] TC-HLM-02 직선 모드 + Shift, 가로로 더 많이 움직임 → 수평선', () => {
    expect(extendStroke([0, 0], 40, 6, 'straight', true, 1.5)).toEqual([0, 0, 40, 0]);
  });

  // 목적: 자유 모드에서 최소 간격만큼 움직였는데 점이 더해지지 않는 결함을 막는다
  it('[BVA] TC-HLM-03 자유 모드, 움직인 거리 = 최소 간격 → 점이 더해짐', () => {
    expect(extendStroke([0, 0], 1.5, 0, 'free', false, 1.5)).toEqual([0, 0, 1.5, 0]);
  });

  // 목적: 아주 조금 움직일 때마다 점이 쌓여 선이 무거워지는 결함을 막는다
  it('[BVA] TC-HLM-04 자유 모드, 움직인 거리 = 최소 간격 - 0.01 → 그대로(null)', () => {
    expect(extendStroke([0, 0], 1.49, 0, 'free', false, 1.5)).toBeNull();
  });
});
