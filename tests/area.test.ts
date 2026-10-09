import { describe, expect, it } from 'vitest';
import { AREA_MIN_CSS, areaToPixels } from '../src/core/area';

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
