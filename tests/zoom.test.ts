import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, fitZoom, formatZoom, zoomIn, zoomOut } from '../src/core/zoom';

describe('확대/축소 비율 (RES-03, EDT-12)', () => {
  // 목적: 최대 비율에서 더 키워 화면이 깨지는 결함을 막는다
  it('[BVA] TC-ZM-01 최대에서 확대 → 최대 그대로', () => {
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
  });

  // 목적: 최대 바로 아래 단계에서 최대로 못 가는 결함을 막는다
  it('[BVA] TC-ZM-02 최대 바로 아래 단계에서 확대 → 최대', () => {
    expect(zoomIn(ZOOM_STEPS[ZOOM_STEPS.length - 2])).toBe(ZOOM_MAX);
  });

  // 목적: 최소 비율에서 더 줄여 0% 이하가 되는 결함을 막는다
  it('[BVA] TC-ZM-03 최소에서 축소 → 최소 그대로', () => {
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
  });

  // 목적: 화면 맞춤 비율(24.3%)처럼 단계 사이 값에서 단계를 건너뛰는 결함을 막는다
  it('[EP] TC-ZM-04 단계 사이 값(24.3%)에서 확대 → 바로 다음 단계(25%), 축소 → 바로 아래 단계(20%)', () => {
    expect(zoomIn(0.243)).toBe(0.25);
    expect(zoomOut(0.243)).toBe(0.2);
  });

  // 목적: 작은 이미지를 화면 맞춤할 때 100%보다 키워 흐리게 보이는 결함을 막는다
  it('[EP] TC-ZM-05 상자보다 작은 이미지 → 100%', () => {
    expect(fitZoom(400, 300, 1200, 800)).toBe(1);
  });

  // 목적: 긴 이미지를 화면 맞춤할 때 세로가 넘쳐 전체가 안 보이는 결함을 막는다
  it('[EP] TC-ZM-06 상자보다 긴 이미지 → 세로 기준 비율', () => {
    expect(fitZoom(2560, 4318, 1200, 800)).toBeCloseTo(800 / 4318);
  });

  // 목적: 정수 비율을 "75.0%"처럼 불필요한 소수로 표시하는 결함을 막는다
  it('[EP] TC-ZM-07 정수 비율 → 소수점 없이 "75%"', () => {
    expect(formatZoom(0.75)).toBe('75%');
  });

  // 목적: 소수 비율을 반올림해 "24%"로 잘못 표시하는 결함을 막는다
  it('[EP] TC-ZM-08 소수 비율 → 소수 첫째 자리 "24.3%"', () => {
    expect(formatZoom(0.2431)).toBe('24.3%');
  });
});
