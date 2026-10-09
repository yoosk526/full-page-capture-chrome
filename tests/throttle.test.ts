import { describe, expect, it } from 'vitest';
import { CAPTURE_INTERVAL_MS, delayBeforeNextCall } from '../src/core/throttle';

const NOW = 100_000;

describe('delayBeforeNextCall: captureVisibleTab 호출 간격 (초당 2회 제한)', () => {
  // 목적: 첫 촬영을 이유 없이 늦추는 결함을 막는다
  it('[EP] TC-THR-01 처음 호출 → 기다리지 않음(0ms)', () => {
    expect(delayBeforeNextCall(null, NOW)).toBe(0);
  });

  // 목적: 간격이 모자란데 바로 호출해 크롬이 오류(호출 한도 초과)를 내는 결함을 막는다
  it('[BVA] TC-THR-02 지난 시간 = 간격-1ms → 1ms 기다림', () => {
    expect(delayBeforeNextCall(NOW - (CAPTURE_INTERVAL_MS - 1), NOW)).toBe(1);
  });

  // 목적: 정확히 간격만큼 지났을 때 불필요하게 더 기다리는 결함을 막는다
  it('[BVA] TC-THR-03 지난 시간 = 간격 → 기다리지 않음', () => {
    expect(delayBeforeNextCall(NOW - CAPTURE_INTERVAL_MS, NOW)).toBe(0);
  });

  // 목적: 간격을 넘긴 경우 음수 대기 시간을 돌려주는 결함을 막는다
  it('[BVA] TC-THR-04 지난 시간 = 간격+1ms → 기다리지 않음(음수 아님)', () => {
    expect(delayBeforeNextCall(NOW - (CAPTURE_INTERVAL_MS + 1), NOW)).toBe(0);
  });
});
