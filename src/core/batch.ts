// 일괄 촬영(SET-32, PR #1 요청)의 주소 목록 정리
import { checkCaptureUrl } from './urlCheck';

/** 한 번에 찍을 수 있는 최대 주소 수 (기존 프로그램 화면의 안내값) */
export const BATCH_MAX = 200;

export interface ParsedUrls {
  /** 찍을 주소 (중복 없이, 적은 순서대로, 최대 BATCH_MAX개) */
  urls: string[];
  /** 주소로 읽을 수 없거나 찍을 수 없는 줄 */
  invalid: string[];
  /** 최대 개수를 넘어 뺀 주소 수 */
  overLimit: number;
}

/**
 * 한 줄에 하나씩 적은 주소를 정리한다. 빈 줄은 건너뛰고 앞뒤 공백은 지운다.
 * TODO(추정): "example.com"처럼 http(s)://가 없으면 https://를 붙인다.
 */
export function parseUrlList(text: string, max: number = BATCH_MAX): ParsedUrls {
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let overLimit = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(line) ? line : `https://${line}`;
    let href: string;
    try {
      href = new URL(withScheme).href;
    } catch {
      invalid.push(line);
      continue;
    }
    if (checkCaptureUrl(href) !== 'ok' || href.startsWith('file:')) {
      invalid.push(line);
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    if (urls.length >= max) overLimit++;
    else urls.push(href);
  }
  return { urls, invalid, overLimit };
}
