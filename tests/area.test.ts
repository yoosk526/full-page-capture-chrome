import { describe, expect, it } from 'vitest';
import {
  AREA_MIN_CSS,
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX,
  AUTO_SCROLL_RANGE,
  areaChunk,
  areaScrollTarget,
  areaToPixels,
  autoScrollStep,
} from '../src/core/area';

describe('areaToPixels: 페이지 일부 영역을 이미지 픽셀로 (PR #1 요청)', () => {
  // 목적: 화면 배율 2에서 영역이 절반 크기로 잘리는 결함을 막는다
  it('[EP] TC-AREA-01 배율 2, 영역 (10,20,100,50) → (20,40,200,100)', () => {
    expect(areaToPixels({ x: 10, y: 20, w: 100, h: 50 }, 2, 2000, 1400)).toEqual({ x: 20, y: 40, w: 200, h: 100 });
  });

  // 목적: 오른쪽 아래에서 왼쪽 위로 끈 영역을 처리하지 못하는 결함을 막는다
  it('[EP] TC-AREA-02 거꾸로 끈 영역(음수 폭·높이) → 바로 세운 영역', () => {
    expect(areaToPixels({ x: 110, y: 70, w: -100, h: -50 }, 1, 1000, 700)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  // 목적: 화면 밖까지 끈 영역이 이미지 밖(빈 픽셀)을 포함하는 결함을 막는다
  it('[EP] TC-AREA-03 화면 오른쪽 밖까지 끈 영역 → 이미지 안쪽만', () => {
    expect(areaToPixels({ x: 900, y: 0, w: 300, h: 100 }, 1, 1000, 700)).toEqual({ x: 900, y: 0, w: 100, h: 100 });
  });

  // 목적: 클릭만 해도(아주 작은 영역) 스크린샷이 만들어지는 결함을 막는다
  it('[BVA] TC-AREA-04 폭 = 최소-1 → 찍지 않음(null)', () => {
    expect(areaToPixels({ x: 0, y: 0, w: AREA_MIN_CSS - 1, h: 50 }, 1, 1000, 700)).toBeNull();
  });

  // 목적: 최소 크기와 같은 영역을 거부하는 off-by-one 결함을 막는다
  it('[BVA] TC-AREA-05 폭 = 최소 → 찍음', () => {
    expect(areaToPixels({ x: 0, y: 0, w: AREA_MIN_CSS, h: 50 }, 1, 1000, 700)).toEqual({ x: 0, y: 0, w: AREA_MIN_CSS, h: 50 });
  });
});

const VH = 700;

describe('autoScrollStep: 영역을 끄는 중 화면 끝 자동 스크롤 (Q43 답변 ②)', () => {
  // 목적: 화면 가운데서 끄는데도 페이지가 저절로 움직이는 결함을 막는다
  it('[EP] TC-ASCR-01 화면 가운데 → 스크롤 안 함(0)', () => {
    expect(autoScrollStep(VH / 2, VH)).toBe(0);
  });

  // 목적: 자동 스크롤 구역이 한 칸 일찍 시작되는 결함을 막는다
  it('[BVA] TC-ASCR-02 아래 끝 구역 바로 바깥(화면 높이-구역) → 0', () => {
    expect(autoScrollStep(VH - AUTO_SCROLL_EDGE, VH)).toBe(0);
  });

  // 목적: 구역에 막 들어왔을 때 스크롤이 시작되지 않는 결함을 막는다
  it('[BVA] TC-ASCR-03 아래 끝 구역에 1px 들어옴 → 아래로 가장 느리게(1)', () => {
    expect(autoScrollStep(VH - AUTO_SCROLL_EDGE + 1, VH)).toBe(1);
  });

  // 목적: 위쪽 끝에서 스크롤 방향이 거꾸로(아래로) 되는 결함을 막는다
  it('[EP] TC-ASCR-04 위쪽 끝 구역 → 위로(음수)', () => {
    expect(autoScrollStep(AUTO_SCROLL_EDGE - 10, VH)).toBeLessThan(0);
  });

  // 목적: 많이 당길수록 빨라지지 않는 결함을 막는다 (조금 당김 < 많이 당김)
  it('[EP] TC-ASCR-05 끝을 10px 넘음 / 100px 넘음 → 많이 넘은 쪽이 더 빠름', () => {
    expect(autoScrollStep(VH + 10, VH)).toBeLessThan(autoScrollStep(VH + 100, VH));
  });

  // 목적: 끝을 아주 멀리 당겼을 때 속도가 한없이 커지는 결함을 막는다
  it('[BVA] TC-ASCR-06 당긴 깊이 = 최대, 최대+1 → 둘 다 최고 속도', () => {
    const atMax = VH - AUTO_SCROLL_EDGE + AUTO_SCROLL_RANGE;
    expect(autoScrollStep(atMax, VH)).toBe(AUTO_SCROLL_MAX);
    expect(autoScrollStep(atMax + 1, VH)).toBe(AUTO_SCROLL_MAX);
  });
});

describe('areaScrollTarget / areaChunk: 화면보다 긴 영역 나눠 찍기 (Q43 답변 ②)', () => {
  // 목적: 영역이 지금 화면 안에 다 보이는데도 페이지를 움직여 고정 머리글 등이 달라지는 결함을 막는다
  it('[EP] TC-ACHK-01 남은 영역이 화면 안 → 지금 위치 그대로', () => {
    expect(areaScrollTarget(1100, 1500, 1000, VH, 5000)).toBe(1000);
  });

  // 목적: 화면 밖 영역을 찍으려고 남은 부분의 위쪽으로 스크롤하지 않는 결함을 막는다
  it('[EP] TC-ACHK-02 남은 영역이 화면 아래로 넘침 → 남은 부분 맨 위로 스크롤', () => {
    expect(areaScrollTarget(1500, 3000, 1000, VH, 5000)).toBe(1500);
  });

  // 목적: 문서 끝을 넘어 스크롤하라고 해 위치 계산이 어긋나는 결함을 막는다
  it('[BVA] TC-ACHK-03 남은 부분 위치 > 최대 스크롤 → 최대 스크롤', () => {
    expect(areaScrollTarget(5000, 5600, 1000, VH, 4900)).toBe(4900);
  });

  // 목적: 문서 끝 근처에서 화면 아래쪽까지만 잘라야 하는데 영역 끝을 넘겨 붙이는 결함을 막는다
  it('[EP] TC-ACHK-04 스크롤이 덜 됨(실제 4900) → 화면 안의 남은 부분만', () => {
    expect(areaChunk(5000, 5300, 4900, VH)).toEqual({ srcY: 100, height: 300 });
  });

  // 목적: 남은 부분이 화면 위에 있어 찍을 수 없는데 엉뚱한 곳을 붙이는 결함을 막는다
  it('[EP] TC-ACHK-05 남은 부분이 지금 화면보다 위 → 붙이지 않음(null)', () => {
    expect(areaChunk(900, 1500, 1000, VH)).toBeNull();
  });
});
