// 파일 이름과 저장 하위 폴더 이름 (RES-02, SET-13)

/** 확장자를 뺀 파일 이름의 최대 길이(글자 수). TODO(미확인): 기존 프로그램의 길이 처리는 모른다. */
export const FILE_NAME_MAX = 100;
/** 저장 하위 폴더 이름의 최대 길이(글자 수). TODO(미확인) */
export const FOLDER_NAME_MAX = 50;

const PREFIX = 'screencapture';

/** 파일 이름에 쓸 수 없는 글자(Windows 기준)와 점, 공백, 제어 문자 → 하이픈 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|.\s\u0000-\u001f\u007f]+/g;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 글자(코드 포인트) 단위로 자른다. 이모지 같은 서로게이트 쌍을 반으로 쪼개지 않는다. */
function truncateCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

/**
 * `screencapture-<도메인>-<경로>` 형태의 파일 이름(확장자 제외)을 만든다.
 * 점과 슬래시는 하이픈으로 바뀐다(RES-02 [확인]).
 * TODO(추정): 쿼리(?…)와 해시(#…)는 넣지 않는다. 포트의 콜론도 하이픈이 된다.
 */
export function buildBaseFileName(pageUrl: string, maxLength: number = FILE_NAME_MAX): string {
  let host = '';
  let path = '';
  try {
    const u = new URL(pageUrl);
    host = u.host;
    path = safeDecode(u.pathname);
  } catch {
    // 주소를 해석할 수 없으면 접두어만 쓴다
  }
  const raw = [PREFIX, host, path].join('-');
  const cleaned = raw.replace(UNSAFE, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const cut = truncateCodePoints(cleaned, maxLength).replace(/-+$/g, '');
  return cut || PREFIX;
}

export type FolderCheck =
  | { ok: true; value: string }
  | { ok: false; reason: 'forbidden-char' | 'dot-name' | 'too-long' | 'reserved-name' };

const FOLDER_FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 저장 하위 폴더 이름을 검사한다 (SET-13). 앞뒤 공백은 지운다. 빈 값이면 다운로드 폴더에 바로 저장한다.
 * TODO(미확인): "a/b" 같은 중첩 폴더 허용 여부를 모르므로 슬래시는 막는다(한 단계 폴더만).
 */
export function checkFolderName(input: string, maxLength: number = FOLDER_NAME_MAX): FolderCheck {
  const value = input.trim();
  if (value === '') return { ok: true, value: '' };
  if (FOLDER_FORBIDDEN.test(value)) return { ok: false, reason: 'forbidden-char' };
  // ".", ".." 그리고 점으로 끝나는 이름은 chrome.downloads가 거부하거나 Windows에서 문제가 된다
  if (/^\.+$/.test(value) || value.endsWith('.') || value.startsWith('.')) return { ok: false, reason: 'dot-name' };
  if (WINDOWS_RESERVED.test(value)) return { ok: false, reason: 'reserved-name' };
  if (Array.from(value).length > maxLength) return { ok: false, reason: 'too-long' };
  return { ok: true, value };
}

/** chrome.downloads에 넘길 상대 경로 */
export function buildDownloadPath(folder: string, baseName: string, ext: string): string {
  const file = `${baseName}.${ext}`;
  return folder ? `${folder}/${file}` : file;
}
