// 설정 값의 형태와 기본값, 검증 (SET-10 ~ SET-23). 저장은 shared/settingsStore.ts

import type { StampDateFormat, StampPosition } from './doc';
import { checkFolderName } from './fileName';

export type FileFormat = 'png' | 'jpg' | 'pdf';
export type PdfPaper = 'full' | 'letter' | 'legal' | 'a4';
export type PdfOrientation = 'portrait' | 'landscape';

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
  /** 용지 방향 (PR #1 요청). 전체 이미지에는 쓰지 않는다 */
  pdfOrientation: PdfOrientation;
  pdfSmartBreak: boolean;
  pdfLinks: boolean;
  pdfHeader: boolean;
  /** PDF로 저장하기 전에 미리보기 창 띄우기 (Q47 답변 ②) */
  pdfPreview: boolean;
  /** 주소·날짜 도장의 마지막 선택값 (EXP-06). TODO(미확인): 다음 촬영에도 유지하는지 모름 → 유지한다 */
  stampPosition: StampPosition;
  stampDateFormat: StampDateFormat;
  /** 펜·형광펜으로 그린 선을 부드럽게 보정 (PR #1 세 번째 요청) */
  smoothStrokes: boolean;
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
  pdfOrientation: 'portrait',
  pdfSmartBreak: true,
  pdfLinks: true,
  pdfHeader: false,
  pdfPreview: true,
  stampPosition: 'none',
  stampDateFormat: 'date',
  smoothStrokes: true,
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
    pdfOrientation: oneOf(r.pdfOrientation, ['portrait', 'landscape'] as const, d.pdfOrientation),
    pdfSmartBreak: bool(r.pdfSmartBreak, d.pdfSmartBreak),
    pdfLinks: bool(r.pdfLinks, d.pdfLinks),
    pdfHeader: bool(r.pdfHeader, d.pdfHeader),
    pdfPreview: bool(r.pdfPreview, d.pdfPreview),
    stampPosition: oneOf(r.stampPosition, ['none', 'top', 'bottom', 'mac', 'windows'] as const, d.stampPosition),
    stampDateFormat: oneOf(r.stampDateFormat, ['date', 'datetime', 'iso', 'none'] as const, d.stampDateFormat),
    smoothStrokes: bool(r.smoothStrokes, d.smoothStrokes),
  };
}
