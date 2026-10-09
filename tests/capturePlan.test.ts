import { describe, expect, it } from 'vitest';
import {
  MAX_PART_AREA,
  MAX_PART_HEIGHT,
  fitToCaptured,
  outputHeightCss,
  pickBackgroundColor,
  placeChunk,
  planScrollPositions,
  splitIntoParts,
  toDeviceSpan,
} from '../src/core/capturePlan';

const VH = 1000;

/** 계획한 모든 조각을 순서대로 붙여 보고 각 조각의 배치를 돌려준다 */
function simulate(
  m: { viewportHeight: number; regionTop: number; regionHeight: number; contentHeight: number },
  actual?: (planned: number, i: number) => number,
) {
  const positions = planScrollPositions(m.contentHeight, m.regionHeight);
  let covered = 0;
  return positions.map((p, i) => {
    const place = placeChunk({
      isFirst: i === 0,
      isLast: i === positions.length - 1,
      actualScroll: actual ? actual(p, i) : p,
      coveredUntil: covered,
      regionTop: m.regionTop,
      regionHeight: m.regionHeight,
      viewportHeight: m.viewportHeight,
    });
    covered = place.coveredUntil;
    return place;
  });
}

describe('planScrollPositions: 스크롤 위치와 조각 수 (CAP-02)', () => {
  // 목적: 화면보다 짧은 페이지에서 불필요한 두 번째 조각을 찍는 결함을 막는다
  it('[BVA] TC-PLAN-01 전체 높이 = 화면 높이-1 → 1조각', () => {
    expect(planScrollPositions(VH - 1, VH)).toEqual([0]);
  });

  // 목적: 높이가 정확히 화면 높이일 때 조각 수가 2로 늘어나는 off-by-one 결함을 막는다
  it('[BVA] TC-PLAN-02 전체 높이 = 화면 높이 → 1조각', () => {
    expect(planScrollPositions(VH, VH)).toEqual([0]);
  });

  // 목적: 화면보다 1px만 길 때 마지막 1px을 빠뜨리는 결함을 막는다
  it('[BVA] TC-PLAN-03 전체 높이 = 화면 높이+1 → 2조각, 마지막 위치는 1px', () => {
    expect(planScrollPositions(VH + 1, VH)).toEqual([0, 1]);
  });

  // 목적: 정확히 배수일 때 맨 아래 위치를 중복으로 한 번 더 찍는 결함을 막는다
  it('[EP] TC-PLAN-04 전체 높이가 화면 높이의 정확한 배수(3배) → 3조각, 위치 중복 없음', () => {
    expect(planScrollPositions(3 * VH, VH)).toEqual([0, 1000, 2000]);
  });

  // 목적: 나머지가 있을 때 마지막 조각이 페이지 밖으로 스크롤하려는 결함을 막는다
  it('[EP] TC-PLAN-05 나머지가 있음(2.5배) → 3조각, 마지막 위치 = 전체-화면 높이', () => {
    expect(planScrollPositions(2500, VH)).toEqual([0, 1000, 1500]);
  });

  // 목적: 높이 0인 문서(빈 페이지)에서 조각 0개로 결과가 안 만들어지는 결함을 막는다
  it('[BVA] TC-PLAN-06 전체 높이 0 → 1조각', () => {
    expect(planScrollPositions(0, VH)).toEqual([0]);
  });

  // 목적: 화면 높이 0(창 최소화 등)에서 무한 반복에 빠지는 결함을 막는다
  it('[EP] TC-PLAN-07 화면 높이 0 → 오류(거부)', () => {
    expect(() => planScrollPositions(1000, 0)).toThrow(RangeError);
  });
});

describe('placeChunk: 조각 이어 붙이기 위치 (CAP-02, CAP-07)', () => {
  // 목적: 마지막 조각이 앞 조각과 겹쳐 같은 내용이 두 번 찍히거나 틈이 생기는 결함을 막는다
  it('[EP] TC-PLACE-01 문서 스크롤, 높이 2.5배 → 조각이 틈·겹침 없이 이어지고 끝 = 결과 높이', () => {
    const m = { viewportHeight: VH, regionTop: 0, regionHeight: VH, contentHeight: 2500 };
    const places = simulate(m);
    expect(places.map((p) => [p.srcY, p.height, p.destY])).toEqual([
      [0, 1000, 0],
      [0, 1000, 1000],
      [500, 500, 2000],
    ]);
    expect(places.at(-1)!.coveredUntil).toBe(outputHeightCss(m));
  });

  // 목적: 내부 스크롤 영역에서 영역 위·아래(머리글, 바닥글)가 빠지거나 반복되는 결함을 막는다
  it('[EP] TC-PLACE-02 내부 스크롤 영역(위 100px, 아래 100px 고정) → 첫 조각에 영역 위, 마지막 조각에 영역 아래 포함', () => {
    const m = { viewportHeight: 800, regionTop: 100, regionHeight: 500, contentHeight: 1200 };
    const places = simulate(m);
    expect(places.map((p) => [p.srcY, p.height, p.destY])).toEqual([
      [0, 600, 0], // 머리글(0~100) + 영역
      [100, 500, 600], // 영역만
      [400, 400, 1100], // 영역 남은 부분 + 바닥글(600~800)
    ]);
    expect(places.at(-1)!.coveredUntil).toBe(outputHeightCss(m));
  });

  // 목적: 페이지가 계획보다 덜 스크롤됐을 때(예: 높이가 줄어듦) 이미 붙인 부분을 다시 덮는 결함을 막는다
  it('[EP] TC-PLACE-03 실제 스크롤이 계획보다 작음 → 이미 붙인 부분은 건너뜀', () => {
    const m = { viewportHeight: VH, regionTop: 0, regionHeight: VH, contentHeight: 2500 };
    const places = simulate(m, (p, i) => (i === 2 ? 1200 : p));
    expect(places[2].destY).toBe(places[1].coveredUntil);
    expect([places[2].srcY, places[2].height]).toEqual([800, 200]);
  });

  // 목적: 스크롤이 전혀 안 되는 페이지에서 첫 화면을 계속 반복해 붙이는 결함을 막는다
  it('[EP] TC-PLACE-04 스크롤이 안 됨(실제 위치 0) → 중간 조각의 붙일 높이 0', () => {
    const m = { viewportHeight: VH, regionTop: 0, regionHeight: VH, contentHeight: 3000 };
    const places = simulate(m, () => 0);
    expect(places[1].height).toBe(0);
  });
});

describe('toDeviceSpan: 화면 배율(devicePixelRatio) 변환', () => {
  // 목적: 배율 1에서 값이 변하는 결함을 막는다
  it('[EP] TC-DPR-01 배율 1(정수) → 값 그대로', () => {
    expect(toDeviceSpan(100, 50, 1)).toEqual({ start: 100, height: 50 });
  });

  // 목적: 배율 2(레티나 화면)에서 위치·높이가 2배가 되지 않는 결함을 막는다
  it('[EP] TC-DPR-02 배율 2(정수) → 위치와 높이 모두 2배', () => {
    expect(toDeviceSpan(1000, 1000, 2)).toEqual({ start: 2000, height: 2000 });
  });

  // 목적: 소수 배율에서 반올림 때문에 조각 사이에 1px 틈이나 겹침이 생기는 결함을 막는다
  it('[EP] TC-DPR-03 배율 1.5(소수), 맞닿은 두 구간 → 변환 뒤에도 틈 없이 맞닿음', () => {
    const a = toDeviceSpan(0, 101, 1.5);
    const b = toDeviceSpan(101, 99, 1.5);
    expect(a.start + a.height).toBe(b.start);
    expect(b.start + b.height).toBe(300);
  });
});

describe('splitIntoParts: 캔버스 한계를 넘는 긴 이미지 나누기 (CAP-08)', () => {
  const W = 2560;
  // 목적: 한계보다 1px 작은 이미지를 쓸데없이 둘로 나누는 결함을 막는다
  it('[BVA] TC-SPLIT-01 높이 = 상한-1 → 1장', () => {
    expect(splitIntoParts(MAX_PART_HEIGHT - 1, W)).toHaveLength(1);
  });

  // 목적: 정확히 상한일 때 빈 두 번째 장(높이 0)을 만드는 결함을 막는다
  it('[BVA] TC-SPLIT-02 높이 = 상한 → 1장', () => {
    expect(splitIntoParts(MAX_PART_HEIGHT, W)).toEqual([{ y: 0, height: MAX_PART_HEIGHT }]);
  });

  // 목적: 상한을 1px 넘을 때 마지막 1px을 잃거나 캔버스 한계를 넘기는 결함을 막는다
  it('[BVA] TC-SPLIT-03 높이 = 상한+1 → 2장, 두 번째 장 높이 1', () => {
    expect(splitIntoParts(MAX_PART_HEIGHT + 1, W)).toEqual([
      { y: 0, height: MAX_PART_HEIGHT },
      { y: MAX_PART_HEIGHT, height: 1 },
    ]);
  });

  // 목적: 폭이 아주 넓을 때 픽셀 수 한계(면적)를 무시하고 높이 한계만 보는 결함을 막는다
  it('[EP] TC-SPLIT-04 폭 16384px, 높이 = 면적 한계+1줄 → 2장(면적 한계로 나눔)', () => {
    const wide = 16384;
    const h = Math.floor(MAX_PART_AREA / wide);
    const parts = splitIntoParts(h + 1, wide);
    expect(parts).toHaveLength(2);
    expect(parts[0].height * wide).toBeLessThanOrEqual(MAX_PART_AREA);
  });

  // 목적: 폭 0(촬영 실패) 입력에서 무한 반복에 빠지는 결함을 막는다
  it('[EP] TC-SPLIT-05 폭 0 → 오류(거부)', () => {
    expect(() => splitIntoParts(100, 0)).toThrow(RangeError);
  });
});

describe('pickBackgroundColor: 이어 붙일 바탕색 (CAP-09)', () => {
  // 목적: 어두운 페이지가 흰 바탕 위에 붙어 빈 곳이 하얗게 보이는 결함을 막는다
  it('[EP] TC-BG-01 html 투명, body 어두움 → body 색', () => {
    expect(pickBackgroundColor(['rgba(0, 0, 0, 0)', 'rgb(18, 18, 18)'])).toBe('rgb(18, 18, 18)');
  });

  // 목적: 둘 다 투명할 때 투명(검게 저장됨) 바탕을 쓰는 결함을 막는다
  it('[EP] TC-BG-02 모두 투명 → 흰색', () => {
    expect(pickBackgroundColor(['transparent', 'rgba(0, 0, 0, 0)'])).toBe('#ffffff');
  });

  // 목적: html에 색이 있는데 body 색을 쓰는 우선순위 결함을 막는다
  it('[EP] TC-BG-03 html 불투명, body 흰색 → html 색', () => {
    expect(pickBackgroundColor(['rgb(0, 0, 0)', 'rgb(255, 255, 255)'])).toBe('rgb(0, 0, 0)');
  });
});

describe('fitToCaptured: 실제로 찍힌 높이에 맞추기', () => {
  const m = { viewportHeight: 700, regionTop: 100, regionHeight: 600, contentHeight: 3000 }; // 영역이 화면 바닥까지
  // 목적: 찍힌 높이가 화면 높이와 같을 때 값을 바꿔 조각 위치가 틀어지는 결함을 막는다
  it('[BVA] TC-FIT-01 찍힌 높이 = 화면 높이 → 그대로', () => {
    expect(fitToCaptured(m, 700)).toEqual(m);
  });

  // 목적: 찍힌 이미지가 더 짧은데 화면 높이를 그대로 써서 조각 사이에 빈 띠가 생기는 결함을 막는다(E2E에서 실제 발견)
  it('[BVA] TC-FIT-02 찍힌 높이 = 화면 높이-1 → 화면·영역 높이를 줄임', () => {
    expect(fitToCaptured(m, 699)).toEqual({ ...m, viewportHeight: 699, regionHeight: 599 });
  });
});
