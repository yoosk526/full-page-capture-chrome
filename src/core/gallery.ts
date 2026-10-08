// 내 스크린샷 목록의 문구와 검색 (GAL-02, GAL-06, GAL-09)
import { dateParts } from './stamp';

/** 주소에서 도메인만. 로컬 파일처럼 도메인이 없으면 빈 문자열 */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 카드 아래 줄: "도메인, 가로x세로, 10월 8일 23:54" (한국어 표기, 24시간, GAL-09 [제안])
 * 도메인이 없는 페이지는 크기부터 적는다 (GAL-02)
 */
export function cardMeta(url: string, width: number, height: number, createdAt: number, timeZone?: string): string {
  const p = dateParts(new Date(createdAt), timeZone);
  const when = `${p.month}월 ${p.day}일 ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  const domain = domainOf(url);
  return [domain, `${width}x${height}`, when].filter(Boolean).join(', ');
}

/** 카드 제목. 페이지 제목이 없으면 기본 이름, 여러 장으로 나뉜 촬영이면 (1/3)처럼 붙인다 */
export function cardTitle(title: string, partIndex: number, partCount: number, fallback: string): string {
  const base = title.trim() || fallback;
  return partCount > 1 ? `${base} (${partIndex + 1}/${partCount})` : base;
}

/**
 * 제목이나 주소에 검색어가 들어 있는 것만 (대소문자 무시, 앞뒤 공백 무시)
 * TODO(미확인): 기존 프로그램의 검색 대상과 방식은 모른다.
 */
export function matchesQuery(item: { title: string; url: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);
}
