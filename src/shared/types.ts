import type { EditorDoc } from '../core/doc';

/** 페이지 안 링크의 위치 (원본 이미지 픽셀 기준). PDF의 클릭 가능한 링크(SET-22)에 쓴다. */
export interface LinkRect {
  x: number;
  y: number;
  w: number;
  h: number;
  href: string;
}

/** 기기 안(IndexedDB)에 보관하는 스크린샷 한 장 */
export interface ShotRecord {
  id: string;
  /** 한 번의 촬영에서 나온 여러 장(CAP-08 분할)을 묶는 값 */
  groupId: string;
  partIndex: number;
  partCount: number;
  createdAt: number;
  url: string;
  title: string;
  width: number;
  height: number;
  /** 촬영 원본 PNG */
  image: Blob;
  /** 목록용 작은 이미지 (페이지 위쪽 부분) */
  thumb: Blob;
  /** 편집 내용. 결과 화면·저장은 이 내용을 원본 위에 그려서 만든다 (RES-08) */
  doc: EditorDoc;
  links: LinkRect[];
}

