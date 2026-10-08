// 설정 값의 형태와 기본값, 검증 (SET-10 ~ SET-23). 저장은 shared/settingsStore.ts

import type { StampDateFormat, StampPosition } from './doc';
import { checkFolderName } from './fileName';

export type FileFormat = 'png' | 'jpg' | 'pdf';
export type PdfPaper = 'full' | 'letter' | 'legal' | 'a4';

export interface Settings {
  fileFormat: FileFormat;
  scrollDelayMs: number;
  /** 0이면 끔 */
  waitImagesMs: number;
  saveFolder: string;
  askWhereToSave: boolean;
  autoDownload: boolean;
  shrinkCopy: boolean;
  pdfPaper: PdfPaper;
  pdfSmartBreak: boolean;
  pdfLinks: boolean;
  pdfHeader: boolean;
  /** 주소·날짜 도장의 마지막 선택값 (EXP-06). TODO(미확인): 다음 촬영에도 유지하는지 모름 → 유지한다 */
  stampPosition: StampPosition;
  stampDateFormat: StampDateFormat;
}

/** TODO(미확인): 선택지 목록은 모른다. 기본값 150ms만 [확인] */
export const SCROLL_DELAY_OPTIONS = [0, 100, 150, 300, 500, 1000, 2000];
/** TODO(미확인): 선택지 목록은 모른다. "끔"만 [확인] */
export const WAIT_IMAGES_OPTIONS = [0, 1000, 3000, 5000];

/** 관찰값을 기본값으로 쓴다 (FEATURES.md 0번 4항: 처음 설치 때의 기본값인지는 모름) */
export const DEFAULT_SETTINGS: Settings = {
  fileFormat: 'png',
  scrollDelayMs: 150,
  waitImagesMs: 0,
  saveFolder: '',
  askWhereToSave: false,
  autoDownload: false,
  shrinkCopy: true,
  pdfPaper: 'full',
  pdfSmartBreak: true,
  pdfLinks: true,
  pdfHeader: false,
  stampPosition: 'none',
  stampDateFormat: 'date',
};

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 저장소에서 읽은 값을 검증한다. 모르는 값·잘못된 값은 기본값으로 되돌린다 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const folder = typeof r.saveFolder === 'string' ? checkFolderName(r.saveFolder) : null;
  return {
    fileFormat: oneOf(r.fileFormat, ['png', 'jpg', 'pdf'] as const, d.fileFormat),
    scrollDelayMs: oneOf(r.scrollDelayMs, SCROLL_DELAY_OPTIONS, d.scrollDelayMs),
    waitImagesMs: oneOf(r.waitImagesMs, WAIT_IMAGES_OPTIONS, d.waitImagesMs),
    saveFolder: folder && folder.ok ? folder.value : d.saveFolder,
    askWhereToSave: bool(r.askWhereToSave, d.askWhereToSave),
    autoDownload: bool(r.autoDownload, d.autoDownload),
    shrinkCopy: bool(r.shrinkCopy, d.shrinkCopy),
    pdfPaper: oneOf(r.pdfPaper, ['full', 'letter', 'legal', 'a4'] as const, d.pdfPaper),
    pdfSmartBreak: bool(r.pdfSmartBreak, d.pdfSmartBreak),
    pdfLinks: bool(r.pdfLinks, d.pdfLinks),
    pdfHeader: bool(r.pdfHeader, d.pdfHeader),
    stampPosition: oneOf(r.stampPosition, ['none', 'top', 'bottom', 'mac', 'windows'] as const, d.stampPosition),
    stampDateFormat: oneOf(r.stampDateFormat, ['date', 'datetime', 'iso', 'none'] as const, d.stampDateFormat),
  };
}
