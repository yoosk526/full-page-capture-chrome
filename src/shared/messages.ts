// 확장 프로그램 안에서 주고받는 메시지 형태

/** 서비스 워커 → 페이지(content script) */
export type ContentRequest =
  | { kind: 'prepare' }
  | { kind: 'scrollTo'; y: number; index: number }
  | { kind: 'waitImages'; timeoutMs: number }
  | { kind: 'suspend' }
  | { kind: 'reapply' }
  | { kind: 'restore' };

export interface PageMetrics {
  viewportWidth: number;
  viewportHeight: number;
  regionTop: number;
  regionHeight: number;
  contentHeight: number;
  /** 문서 전체 스크롤이면 true, 내부 스크롤 영역이면 false */
  documentScroll: boolean;
  background: string;
  title: string;
  url: string;
  /** 문서 기준 CSS px 위치 */
  links: { x: number; y: number; w: number; h: number; href: string }[];
}

export const POPUP_PORT = 'capture-popup';

/** 팝업 → 서비스 워커 */
export type PopupToWorker =
  | { kind: 'query'; tabId: number }
  | { kind: 'area'; tabId: number; windowId: number }
  | { kind: 'open'; tabId: number; windowId: number }
  | { kind: 'togglePause' }
  | { kind: 'stop' };

export type CaptureStage = 'scroll' | 'stitch' | 'save';

/** 서비스 워커 → 팝업 */
export type WorkerToPopup =
  /** 팝업이 열렸을 때: 이 탭에서 촬영이 진행(또는 멈춤) 중인지, 단축키로 "전체 찍기"를 눌러 열렸는지 */
  | { kind: 'state'; active: boolean; autoStartFull: boolean }
  | {
      kind: 'progress';
      current: number;
      total: number;
      stage: CaptureStage;
      paused: boolean;
      width: number;
      height: number;
    }
  | { kind: 'error'; reason: 'file-access' | 'generic'; message: string }
  | { kind: 'done'; autoDownloaded: boolean };

/** 영역 고르기 화면(area.js) → 서비스 워커 */
export interface AreaSelected {
  kind: 'areaSelected';
  rect: { x: number; y: number; w: number; h: number };
  viewportWidth: number;
  title: string;
  url: string;
}

export const BATCH_PORT = 'batch';

/** 일괄 촬영 화면 → 서비스 워커 */
export type BatchToWorker = { kind: 'start'; urls: string[] } | { kind: 'stop' };

/** 서비스 워커 → 일괄 촬영 화면 */
export type WorkerToBatch =
  | { kind: 'item'; index: number; total: number; url: string; status: 'running' | 'ok' | 'failed'; error?: string }
  | { kind: 'finished'; ok: number; failed: number; stopped: boolean };
