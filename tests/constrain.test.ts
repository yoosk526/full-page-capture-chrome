import { describe, expect, it } from 'vitest';
import { constrainSquare, snapStraight } from '../src/core/constrain';

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
