import { describe, expect, it } from 'vitest';
import { BATCH_MAX, parseUrlList } from '../src/core/batch';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `https://example.com/p${i}`).join('\n');

describe('parseUrlList: 일괄 촬영 주소 목록 (SET-32, PR #1 요청)', () => {
  // 목적: 빈 줄이나 앞뒤 공백 때문에 주소가 빠지거나 잘못 들어가는 결함을 막는다
  it('[EP] TC-BATCH-01 빈 줄·앞뒤 공백이 섞인 목록 → 주소만 순서대로', () => {
    expect(parseUrlList('  https://a.com/x  \n\n\thttps://b.com\n').urls).toEqual(['https://a.com/x', 'https://b.com/']);
  });

  // 목적: "naver.com"처럼 http(s)://를 빼고 적은 주소를 버리는 결함을 막는다
  it('[EP] TC-BATCH-02 http(s):// 없이 적은 주소 → https://를 붙여 받음', () => {
    expect(parseUrlList('naver.com/news').urls).toEqual(['https://naver.com/news']);
  });

  // 목적: 찍을 수 없는 주소(브라우저 설정, 내 컴퓨터 파일)로 촬영을 시도하는 결함을 막는다
  it('[EP] TC-BATCH-03 chrome:// · file:// · 주소가 아닌 글 → 잘못된 줄로 분류', () => {
    const r = parseUrlList('chrome://settings\nfile:///C:/a.html\nhttp://\nhttps://ok.com');
    expect(r.urls).toEqual(['https://ok.com/']);
    expect(r.invalid).toEqual(['chrome://settings', 'file:///C:/a.html', 'http://']);
  });

  // 목적: 같은 주소를 두 번 찍어 시간을 낭비하는 결함을 막는다
  it('[EP] TC-BATCH-04 같은 주소가 두 번 → 한 번만', () => {
    expect(parseUrlList('https://a.com\nhttps://a.com/').urls).toEqual(['https://a.com/']);
  });

  // 목적: 최대 개수 바로 아래 목록을 잘라 버리는 결함을 막는다
  it('[BVA] TC-BATCH-05 주소 = 최대-1개 → 모두 받음', () => {
    const r = parseUrlList(lines(BATCH_MAX - 1));
    expect([r.urls.length, r.overLimit]).toEqual([BATCH_MAX - 1, 0]);
  });

  // 목적: 정확히 최대 개수일 때 하나를 빼는 off-by-one 결함을 막는다
  it('[BVA] TC-BATCH-06 주소 = 최대개 → 모두 받음', () => {
    const r = parseUrlList(lines(BATCH_MAX));
    expect([r.urls.length, r.overLimit]).toEqual([BATCH_MAX, 0]);
  });

  // 목적: 최대 개수를 넘는 주소를 모두 찍으려 하는 결함을 막는다
  it('[BVA] TC-BATCH-07 주소 = 최대+1개 → 최대개만 받고 1개는 넘침으로 셈', () => {
    const r = parseUrlList(lines(BATCH_MAX + 1));
    expect([r.urls.length, r.overLimit]).toEqual([BATCH_MAX, 1]);
  });
});
