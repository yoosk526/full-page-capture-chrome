// 캡처 가능한 주소인지 판별 (CAP-10, CAP-11)
//
// [확인] chrome:// 계열과 웹 스토어는 브라우저가 보호해 어떤 확장 프로그램도 찍을 수 없다.
// TODO(미확인): 막히는 주소의 정확한 전체 목록은 모른다. 여기서는 일반 웹(http, https)과
// 로컬 파일(file)만 허용하고 나머지 스킴은 모두 보호 페이지로 본다.

export type UrlCheck = 'ok' | 'protected';

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:']);

/** 웹 스토어 주소 (새 주소와 예전 주소) */
function isWebStore(u: URL): boolean {
  if (u.hostname === 'chromewebstore.google.com') return true;
  return u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore');
}

export function checkCaptureUrl(url: string | undefined | null): UrlCheck {
  if (!url) return 'protected';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'protected';
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return 'protected';
  if (isWebStore(u)) return 'protected';
  return 'ok';
}
