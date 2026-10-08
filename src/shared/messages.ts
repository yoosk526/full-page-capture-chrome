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
  | { kind: 'open'; tabId: number; windowId: number }
  | { kind: 'togglePause' }
  | { kind: 'stop' };

export type CaptureStage = 'scroll' | 'stitch' | 'save';

/** 서비스 워커 → 팝업 */
export type WorkerToPopup =
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
