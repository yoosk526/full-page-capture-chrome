import { describe, expect, it } from 'vitest';
import { checkCaptureUrl } from '../src/core/urlCheck';

describe('checkCaptureUrl: 캡처 가능한 주소 판별 (CAP-10, CAP-11)', () => {
  // 목적: 일반 웹사이트를 보호 페이지로 잘못 막는 결함을 막는다
  it('[EP] TC-URL-01 일반 https 주소 → 촬영 가능', () => {
    expect(checkCaptureUrl('https://www.example.com/news?id=1')).toBe('ok');
  });

  // 목적: 브라우저 설정 같은 chrome:// 계열에서 촬영을 시도해 오류가 나는 결함을 막는다
  it('[EP] TC-URL-02 chrome:// 계열 → 보호 페이지', () => {
    expect(checkCaptureUrl('chrome://settings/')).toBe('protected');
  });

  // 목적: 웹 스토어(https지만 보호됨)를 일반 사이트로 보고 촬영하려는 결함을 막는다
  it('[EP] TC-URL-03 웹 스토어(새 주소) → 보호 페이지', () => {
    expect(checkCaptureUrl('https://chromewebstore.google.com/detail/abc')).toBe('protected');
  });

  // 목적: 예전 웹 스토어 주소를 놓치는 결함을 막는다
  it('[EP] TC-URL-04 웹 스토어(예전 주소 chrome.google.com/webstore) → 보호 페이지', () => {
    expect(checkCaptureUrl('https://chrome.google.com/webstore/detail/abc')).toBe('protected');
  });

  // 목적: 로컬 파일(CAP-10 지원 범위)을 보호 페이지로 잘못 막는 결함을 막는다
  it('[EP] TC-URL-05 file:// 로컬 파일 → 촬영 가능', () => {
    expect(checkCaptureUrl('file:///C:/Users/me/report.html')).toBe('ok');
  });

  // 목적: 주소를 알 수 없는 탭(권한 없음)에서 촬영을 시도하는 결함을 막는다
  it('[EP] TC-URL-06 주소 없음(undefined) → 보호 페이지', () => {
    expect(checkCaptureUrl(undefined)).toBe('protected');
  });
});
