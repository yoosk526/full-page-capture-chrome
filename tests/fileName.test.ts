import { describe, expect, it } from 'vitest';
import { FILE_NAME_MAX, FOLDER_NAME_MAX, buildBaseFileName, checkFolderName } from '../src/core/fileName';

const PREFIX = 'screencapture-a-com-'; // https://a.com/ 의 접두 부분 (20자)

/** 파일 이름 전체 길이가 n자가 되도록 경로를 만든다 */
function urlForLength(n: number): string {
  return `https://a.com/${'x'.repeat(n - PREFIX.length)}`;
}

const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe('buildBaseFileName: 파일 이름 만들기 (RES-02)', () => {
  // 목적: 점과 슬래시가 하이픈으로 바뀌는 규칙(RES-02)이 깨지는 결함을 막는다
  it('[EP] TC-FN-01 일반 주소 → screencapture-도메인-경로 (점·슬래시 → 하이픈)', () => {
    expect(buildBaseFileName('https://www.example.com/docs/page.html')).toBe(
      'screencapture-www-example-com-docs-page-html',
    );
  });

  // 목적: 파일 이름에 쓸 수 없는 글자 때문에 저장이 실패하는 결함을 막는다
  it('[EP] TC-FN-02 금지 문자(" < > | : *)가 든 경로 → 하이픈으로 바뀌고 연속 하이픈은 하나로', () => {
    expect(buildBaseFileName('https://a.com/a%22b%3Cc%3Ed%7Ce:f*g')).toBe('screencapture-a-com-a-b-c-d-e-f-g');
  });

  // 목적: 주소가 비었을 때 빈 파일 이름(".png")을 만드는 결함을 막는다
  it('[EP] TC-FN-03 빈 주소 → screencapture', () => {
    expect(buildBaseFileName('')).toBe('screencapture');
  });

  // 목적: 길이 상한 바로 아래 이름을 잘라 버리는 결함을 막는다
  it('[BVA] TC-FN-04 길이 = 상한-1 → 자르지 않음', () => {
    expect(buildBaseFileName(urlForLength(FILE_NAME_MAX - 1))).toHaveLength(FILE_NAME_MAX - 1);
  });

  // 목적: 정확히 상한 길이의 이름을 한 글자 더 자르는 결함을 막는다
  it('[BVA] TC-FN-05 길이 = 상한 → 그대로', () => {
    expect(buildBaseFileName(urlForLength(FILE_NAME_MAX))).toHaveLength(FILE_NAME_MAX);
  });

  // 목적: 상한을 넘는 긴 이름이 그대로 나가 저장 경로 한계를 넘는 결함을 막는다
  it('[BVA] TC-FN-06 길이 = 상한+1 → 상한으로 자름', () => {
    expect(buildBaseFileName(urlForLength(FILE_NAME_MAX + 1))).toHaveLength(FILE_NAME_MAX);
  });

  // 목적: 퍼센트 인코딩된 한글 경로가 %EC%BA… 같은 알아볼 수 없는 이름이 되는 결함을 막는다
  it('[EP] TC-FN-07 한글 경로 → 한글 그대로', () => {
    expect(buildBaseFileName('https://ko.wikipedia.org/wiki/%EC%BA%A1%EC%B2%98')).toBe(
      'screencapture-ko-wikipedia-org-wiki-캡처',
    );
  });

  // 목적: 자르는 위치에 이모지가 걸릴 때 반쪽 글자(깨진 문자)가 남는 결함을 막는다
  it('[BVA] TC-FN-08 상한 위치에 이모지 → 이모지를 쪼개지 않음', () => {
    const path = 'x'.repeat(FILE_NAME_MAX - PREFIX.length - 1) + '😀😀';
    const name = buildBaseFileName(`https://a.com/${encodeURIComponent(path)}`);
    expect(Array.from(name)).toHaveLength(FILE_NAME_MAX);
    expect(name.endsWith('😀')).toBe(true);
    expect(hasLoneSurrogate(name)).toBe(false);
  });
});

describe('checkFolderName: 저장 하위 폴더 이름 (SET-13)', () => {
  // 목적: 빈 값을 오류로 막아 다운로드 폴더에 바로 저장하지 못하는 결함을 막는다
  it('[EP] TC-FD-01 빈 값 → 허용(다운로드 폴더에 바로 저장)', () => {
    expect(checkFolderName('')).toEqual({ ok: true, value: '' });
  });

  // 목적: 평범한 폴더 이름을 거부하는 결함을 막는다
  it('[EP] TC-FD-02 일반 이름 → 허용', () => {
    expect(checkFolderName('screenshots')).toEqual({ ok: true, value: 'screenshots' });
  });

  // 목적: 앞뒤 공백 때문에 " shots " 같은 이상한 폴더가 생기는 결함을 막는다
  it('[EP] TC-FD-03 앞뒤 공백 → 지우고 허용', () => {
    expect(checkFolderName('  shots  ')).toEqual({ ok: true, value: 'shots' });
  });

  // 목적: 금지 문자 때문에 저장 자체가 실패하는 결함을 막는다
  it('[EP] TC-FD-04 금지 문자(*) → 거부', () => {
    expect(checkFolderName('a*b')).toEqual({ ok: false, reason: 'forbidden-char' });
  });

  // 목적: ".."로 다운로드 폴더 바깥에 저장하려는 시도를 막는다
  it('[EP] TC-FD-05 ".." → 거부', () => {
    expect(checkFolderName('..')).toEqual({ ok: false, reason: 'dot-name' });
  });

  // 목적: Windows 예약 이름 폴더를 만들려다 저장이 실패하는 결함을 막는다
  it('[EP] TC-FD-06 예약 이름(CON) → 거부', () => {
    expect(checkFolderName('CON')).toEqual({ ok: false, reason: 'reserved-name' });
  });

  // 목적: 길이 상한 바로 아래 이름을 거부하는 결함을 막는다
  it('[BVA] TC-FD-07 길이 = 상한-1 → 허용', () => {
    expect(checkFolderName('a'.repeat(FOLDER_NAME_MAX - 1)).ok).toBe(true);
  });

  // 목적: 정확히 상한 길이를 거부하는 off-by-one 결함을 막는다
  it('[BVA] TC-FD-08 길이 = 상한 → 허용', () => {
    expect(checkFolderName('a'.repeat(FOLDER_NAME_MAX)).ok).toBe(true);
  });

  // 목적: 상한을 넘는 이름을 받아들이는 결함을 막는다
  it('[BVA] TC-FD-09 길이 = 상한+1 → 거부', () => {
    expect(checkFolderName('a'.repeat(FOLDER_NAME_MAX + 1))).toEqual({ ok: false, reason: 'too-long' });
  });
});
