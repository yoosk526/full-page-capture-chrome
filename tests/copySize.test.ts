import { describe, expect, it } from 'vitest';
import { COPY_PIXEL_LIMIT, needsShrink, shrinkSize } from '../src/core/copySize';

describe('needsShrink: 복사본 축소 판정 (EXP-04, SET-16) - 25,000,000을 "넘을" 때만 축소', () => {
  // 목적: 한도보다 작은 이미지를 줄여 화질을 떨어뜨리는 결함을 막는다
  it('[BVA] TC-COPY-01 24,999,999픽셀(4999x5001) → 줄이지 않음', () => {
    expect(needsShrink(4999, 5001, true)).toBe(false);
  });

  // 목적: 정확히 한도인 이미지를 줄이는(이상/초과 혼동) 결함을 막는다
  it('[BVA] TC-COPY-02 25,000,000픽셀(5000x5000) → 줄이지 않음', () => {
    expect(needsShrink(5000, 5000, true)).toBe(false);
  });

  // 목적: 한도를 넘는 이미지를 그대로 복사해 붙여넣기가 실패하는 결함을 막는다
  it('[BVA] TC-COPY-03 25,000,001픽셀(4901x5101) → 줄임', () => {
    expect(needsShrink(4901, 5101, true)).toBe(true);
  });

  // 목적: 설정을 끈 사용자의 큰 이미지를 마음대로 줄이는 결함을 막는다
  it('[EP] TC-COPY-04 설정 꺼짐 + 한도 초과 → 줄이지 않음', () => {
    expect(needsShrink(4901, 5101, false)).toBe(false);
  });
});

describe('shrinkSize: 줄인 크기', () => {
  // 목적: 줄인 뒤에도 한도를 넘거나 가로세로 비율이 틀어지는 결함을 막는다
  it('[EP] TC-COPY-05 긴 이미지(2560x14217) → 한도 이하, 비율 유지', () => {
    const r = shrinkSize(2560, 14217);
    expect(r.width * r.height).toBeLessThanOrEqual(COPY_PIXEL_LIMIT);
    expect(r.width / r.height).toBeCloseTo(2560 / 14217, 2);
    // 너무 많이 줄이지도 않는다(한도의 99% 이상)
    expect(r.width * r.height).toBeGreaterThan(COPY_PIXEL_LIMIT * 0.99);
  });
});
