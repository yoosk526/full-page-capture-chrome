import { describe, expect, it } from 'vitest';
import { CROP_MIN, clampCrop } from '../src/core/crop';

const W = 1000;
const H = 800;

describe('clampCrop: 자르기 영역 보정 (EDT-02)', () => {
  // 목적: 이미지 안쪽 영역을 쓸데없이 바꾸는 결함을 막는다
  it('[EP] TC-CROP-01 영역이 이미지 안 → 그대로', () => {
    expect(clampCrop({ x: 100, y: 50, w: 300, h: 200 }, W, H)).toEqual({ x: 100, y: 50, w: 300, h: 200 });
  });

  // 목적: 일부가 이미지 밖인 영역을 그대로 써서 빈(투명) 부분이 저장되는 결함을 막는다
  it('[EP] TC-CROP-02 영역 일부가 밖 → 이미지 안쪽만 남김', () => {
    expect(clampCrop({ x: -50, y: 700, w: 200, h: 300 }, W, H)).toEqual({ x: 0, y: 700, w: 150, h: 100 });
  });

  // 목적: 완전히 밖인 영역으로 잘라 크기 0 이미지가 만들어지는 결함을 막는다
  it('[EP] TC-CROP-03 영역이 완전히 밖 → null(적용하지 않음)', () => {
    expect(clampCrop({ x: 1200, y: 100, w: 100, h: 100 }, W, H)).toBeNull();
  });

  // 목적: 폭이 0인(클릭만 한) 영역으로 자르는 결함을 막는다
  it('[BVA] TC-CROP-04 폭 0 → null', () => {
    expect(clampCrop({ x: 100, y: 100, w: 0, h: 100 }, W, H)).toBeNull();
  });

  // 목적: 최소 크기 바로 아래를 받아들이는 결함을 막는다
  it('[BVA] TC-CROP-05 높이 = 최소-1 → null', () => {
    expect(clampCrop({ x: 0, y: 0, w: 100, h: CROP_MIN - 1 }, W, H)).toBeNull();
  });

  // 목적: 정확히 최소 크기를 거부하는 off-by-one 결함을 막는다
  it('[BVA] TC-CROP-06 높이 = 최소 → 허용', () => {
    expect(clampCrop({ x: 0, y: 0, w: 100, h: CROP_MIN }, W, H)).toEqual({ x: 0, y: 0, w: 100, h: CROP_MIN });
  });

  // 목적: 오른쪽 위에서 왼쪽 아래로 끈 영역(음수 폭·높이)을 잘못 처리하는 결함을 막는다
  it('[EP] TC-CROP-07 역방향 드래그(음수 폭·높이) → 바로 세운 영역', () => {
    expect(clampCrop({ x: 400, y: 300, w: -200, h: -100 }, W, H)).toEqual({ x: 200, y: 200, w: 200, h: 100 });
  });

  // 목적: 이미지 경계와 정확히 맞는 영역(전체)을 1px 줄이는 결함을 막는다
  it('[BVA] TC-CROP-08 오른쪽 끝 = 이미지 폭 → 그대로', () => {
    expect(clampCrop({ x: 0, y: 0, w: W, h: H }, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  // 목적: 경계를 1px 넘은 영역이 이미지 밖 1px을 포함하는 결함을 막는다
  it('[BVA] TC-CROP-09 오른쪽 끝 = 이미지 폭+1 → 이미지 폭으로 맞춤', () => {
    expect(clampCrop({ x: 0, y: 0, w: W + 1, h: H }, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  // 목적: 경계 1px 안쪽을 이미지 끝으로 잘못 늘리는 결함을 막는다
  it('[BVA] TC-CROP-10 오른쪽 끝 = 이미지 폭-1 → 그대로', () => {
    expect(clampCrop({ x: 0, y: 0, w: W - 1, h: H }, W, H)).toEqual({ x: 0, y: 0, w: W - 1, h: H });
  });
});
