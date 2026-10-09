import { describe, expect, it } from 'vitest';
import { cardMeta, cardTitle, matchesQuery } from '../src/core/gallery';

const SEOUL = 'Asia/Seoul';
const AT = Date.parse('2026-10-08T14:54:00Z'); // 서울 10월 8일 23:54

describe('cardMeta: 카드 아래 줄 (GAL-02, GAL-09)', () => {
  // 목적: 도메인·크기·날짜의 순서나 한국어 날짜 표기(24시간)가 틀리는 결함을 막는다
  it('[EP] TC-GAL-01 도메인 있음 → "example.com, 2560x1353, 10월 8일 23:54"', () => {
    expect(cardMeta('https://example.com/a', 2560, 1353, AT, SEOUL)).toBe('example.com, 2560x1353, 10월 8일 23:54');
  });

  // 목적: 도메인이 없는 로컬 파일에서 ", 2560x1353"처럼 앞에 쉼표가 남는 결함을 막는다
  it('[EP] TC-GAL-02 도메인 없음(file://) → 크기부터 "1309x14217, 10월 8일 23:54"', () => {
    expect(cardMeta('file:///C:/a.html', 1309, 14217, AT, SEOUL)).toBe('1309x14217, 10월 8일 23:54');
  });

  // 목적: 한 자리 시·분이 "9:5"처럼 표시되는 결함을 막는다
  it('[EP] TC-GAL-03 오전 9시 5분 → "09:05"', () => {
    expect(cardMeta('https://a.com', 1, 1, Date.parse('2026-10-09T00:05:00Z'), SEOUL)).toBe('a.com, 1x1, 10월 9일 09:05');
  });
});

describe('cardTitle: 카드 제목 (GAL-02)', () => {
  // 목적: 페이지 제목이 없을 때 빈 제목 카드가 나오는 결함을 막는다
  it('[EP] TC-GAL-04 제목 없음(공백만) → 기본 이름', () => {
    expect(cardTitle('   ', 0, 1, '스크린샷')).toBe('스크린샷');
  });

  // 목적: 나뉘어 보관된 긴 페이지의 카드들을 구별할 수 없는 결함을 막는다
  it('[EP] TC-GAL-05 3장으로 나뉜 촬영의 두 번째 → "제목 (2/3)"', () => {
    expect(cardTitle('긴 문서', 1, 3, '스크린샷')).toBe('긴 문서 (2/3)');
  });
});

describe('matchesQuery: 검색 (GAL-06, 동작은 [미확인] → 제목·주소 포함 검색)', () => {
  const item = { title: 'Release Notes', url: 'https://docs.example.com/v2' };
  // 목적: 빈 검색어에서 목록이 비는 결함을 막는다
  it('[EP] TC-GAL-06 빈 검색어(공백) → 모두 보임', () => {
    expect(matchesQuery(item, '  ')).toBe(true);
  });

  // 목적: 대소문자가 다르면 못 찾는 결함을 막는다
  it('[EP] TC-GAL-07 제목 일부(대소문자 다름 "release") → 찾음', () => {
    expect(matchesQuery(item, 'release')).toBe(true);
  });

  // 목적: 제목에 없고 주소에만 있는 검색어를 못 찾는 결함을 막는다
  it('[EP] TC-GAL-08 주소에만 있는 말("docs.example") → 찾음', () => {
    expect(matchesQuery(item, 'docs.example')).toBe(true);
  });

  // 목적: 관계없는 검색어에도 결과가 나오는 결함을 막는다
  it('[EP] TC-GAL-09 어디에도 없는 말 → 못 찾음', () => {
    expect(matchesQuery(item, '영수증')).toBe(false);
  });
});
