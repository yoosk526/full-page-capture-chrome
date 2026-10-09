import { describe, expect, it } from 'vitest';
import { buildStamp, formatStampDate, outputLayout, stampHeight } from '../src/core/stamp';

const SEOUL = 'Asia/Seoul';
// 2026-10-09 00:02:26 (서울, UTC+9) = 2026-10-08 15:02:26 UTC  (FEATURES.md EXP-06 관찰 예시와 같은 시각)
const SAMPLE = new Date('2026-10-08T15:02:26Z');

describe('formatStampDate: 날짜 형식 4가지 (EXP-06)', () => {
  // 목적: "날짜" 형식이 관찰된 한국어 표기(2026년 10월 9일)와 다르게 나오는 결함을 막는다
  it('[EP] TC-STAMP-01 날짜 → "2026년 10월 9일"', () => {
    expect(formatStampDate(SAMPLE, 'date', SEOUL)).toBe('2026년 10월 9일');
  });

  // 목적: 자정 직후가 "오전 0:02"처럼 12시간 표기 규칙을 어기거나 시간대가 빠지는 결함을 막는다
  it('[EP] TC-STAMP-02 날짜 및 시간 → "2026년 10월 9일 오전 12:02 GMT+9"', () => {
    expect(formatStampDate(SAMPLE, 'datetime', SEOUL)).toBe('2026년 10월 9일 오전 12:02 GMT+9');
  });

  // 목적: ISO 형식에서 초나 시간대(+09:00)가 빠지는 결함을 막는다
  it('[EP] TC-STAMP-03 ISO → "2026-10-09T00:02:26+09:00"', () => {
    expect(formatStampDate(SAMPLE, 'iso', SEOUL)).toBe('2026-10-09T00:02:26+09:00');
  });

  // 목적: "날짜 없음"인데 날짜가 들어가는 결함을 막는다
  it('[EP] TC-STAMP-04 날짜 없음 → 빈 문자열', () => {
    expect(formatStampDate(SAMPLE, 'none', SEOUL)).toBe('');
  });

  // 목적: 자정 1초 전이 다음 날로 넘어가거나 "오후 11:59"가 틀리는 결함을 막는다
  it('[BVA] TC-STAMP-05 서울 23:59:59 → 10월 8일 오후 11:59', () => {
    expect(formatStampDate(new Date('2026-10-08T14:59:59Z'), 'datetime', SEOUL)).toBe('2026년 10월 8일 오후 11:59 GMT+9');
  });

  // 목적: 정확히 자정에 날짜가 바뀌지 않거나 "오전 0:00"으로 표시되는 결함을 막는다
  it('[BVA] TC-STAMP-06 서울 00:00:00 → 10월 9일 오전 12:00', () => {
    expect(formatStampDate(new Date('2026-10-08T15:00:00Z'), 'datetime', SEOUL)).toBe('2026년 10월 9일 오전 12:00 GMT+9');
  });

  // 목적: 시간대를 무시하고 UTC 날짜를 쓰는 결함(서울은 이미 다음 날)을 막는다
  it('[EP] TC-STAMP-07 같은 순간 UTC 15:02 → UTC로는 10월 8일, 서울로는 10월 9일', () => {
    expect(formatStampDate(SAMPLE, 'iso', 'UTC')).toBe('2026-10-08T15:02:26+00:00');
    expect(formatStampDate(SAMPLE, 'date', SEOUL)).toBe('2026년 10월 9일');
  });
});

describe('buildStamp: 위치 5가지 × 날짜 형식 대표 조합 (EXP-06)', () => {
  const url = 'https://example.com/a';
  // 목적: "표시 안 함"인데 띠가 붙는 결함을 막는다
  it('[EP] TC-STAMP-08 표시 안 함 + 날짜 → 도장 없음(null)', () => {
    expect(buildStamp('none', 'date', url, SAMPLE, SEOUL)).toBeNull();
  });

  // 목적: 위쪽 띠의 배치·내용(왼쪽 주소, 오른쪽 날짜)이 틀리는 결함을 막는다
  it('[EP] TC-STAMP-09 위쪽 띠 + 날짜 → 위, 띠 모양, 주소와 날짜', () => {
    expect(buildStamp('top', 'date', url, SAMPLE, SEOUL)).toEqual({ position: 'top', placement: 'top', frame: 'band', url, date: '2026년 10월 9일' });
  });

  // 목적: 아래쪽 띠가 이미지 위에 붙는 결함을 막는다
  it('[EP] TC-STAMP-10 아래쪽 띠 + 날짜와 시간 → 아래, 띠 모양', () => {
    const s = buildStamp('bottom', 'datetime', url, SAMPLE, SEOUL)!;
    expect([s.placement, s.frame, s.date]).toEqual(['bottom', 'band', '2026년 10월 9일 오전 12:02 GMT+9']);
  });

  // 목적: Mac 브라우저 창 모양이 일반 띠로 그려지는 결함을 막는다
  it('[EP] TC-STAMP-11 Mac 브라우저 + ISO → 위, mac 창 모양', () => {
    const s = buildStamp('mac', 'iso', url, SAMPLE, SEOUL)!;
    expect([s.placement, s.frame, s.date]).toEqual(['top', 'mac', '2026-10-09T00:02:26+09:00']);
  });

  // 목적: 날짜 없음을 골랐는데 Windows 창 모양에 날짜가 남는 결함을 막는다
  it('[EP] TC-STAMP-12 Windows 브라우저 + 날짜 없음 → 위, windows 창 모양, 날짜 빈 문자열', () => {
    const s = buildStamp('windows', 'none', url, SAMPLE, SEOUL)!;
    expect([s.placement, s.frame, s.url, s.date]).toEqual(['top', 'windows', url, '']);
  });
});

describe('outputLayout: 도장과 자르기를 반영한 결과 크기', () => {
  const crop = { x: 10, y: 20, w: 800, h: 600 };
  // 목적: 위쪽 도장이 이미지를 덮어(높이를 늘리지 않고) 내용을 가리는 결함을 막는다
  it('[EP] TC-LAYOUT-01 위쪽 띠 → 높이 = 자른 높이 + 띠, 이미지는 띠 아래에서 시작', () => {
    const h = stampHeight('top', 800);
    const L = outputLayout({ crop, stamp: { position: 'top', dateFormat: 'date' } }, 1000, 1000);
    expect([L.width, L.height, L.imageY, L.stamp]).toEqual([800, 600 + h, h, { y: 0, h }]);
  });

  // 목적: 아래쪽 띠가 이미지 위쪽에 자리 잡는 결함을 막는다
  it('[EP] TC-LAYOUT-02 아래쪽 띠 → 이미지는 0에서 시작, 띠는 이미지 바로 아래', () => {
    const L = outputLayout({ crop, stamp: { position: 'bottom', dateFormat: 'date' } }, 1000, 1000);
    expect([L.imageY, L.stamp!.y]).toEqual([0, 600]);
  });

  // 목적: 도장이 없는데 결과 크기가 원본과 달라지는 결함을 막는다
  it('[EP] TC-LAYOUT-03 표시 안 함, 자르기 없음 → 원본 크기 그대로', () => {
    const L = outputLayout({ crop: null, stamp: { position: 'none', dateFormat: 'date' } }, 1000, 700);
    expect([L.width, L.height, L.stamp]).toEqual([1000, 700, null]);
  });
});
