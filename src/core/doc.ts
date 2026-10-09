// 편집 문서 모델 (EDT). 좌표는 모두 원본 이미지 픽셀 기준이다.

export type StampPosition = 'none' | 'top' | 'bottom' | 'mac' | 'windows';
export type StampDateFormat = 'date' | 'datetime' | 'iso' | 'none';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Base {
  id: string;
}

export interface RectObj extends Base, Rect {
  type: 'rect';
  color: string;
  width: number;
  fill: string | null;
  radius: number;
}
export interface EllipseObj extends Base, Rect {
  type: 'ellipse';
  color: string;
  width: number;
  fill: string | null;
}
export interface ArrowObj extends Base {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  heads: 'one' | 'both';
}
export interface LineObj extends Base {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}
export interface TextObj extends Base, Rect {
  type: 'text';
  text: string;
  color: string;
  fill: string | null;
  fontSize: number;
}
export interface BlurObj extends Base, Rect {
  type: 'blur';
  strength: number;
  mode: 'blur' | 'mosaic';
}
export interface BadgeObj extends Base, Rect {
  type: 'badge';
  color: string;
  number: number;
}
export interface PathObj extends Base {
  type: 'highlighter' | 'pen' | 'brush';
  /** [x0, y0, x1, y1, ...] */
  points: number[];
  color: string;
  width: number;
}

export type EditorObject = RectObj | EllipseObj | ArrowObj | LineObj | TextObj | BlurObj | BadgeObj | PathObj;
export type ObjectType = EditorObject['type'];

export interface EditorDoc {
  version: 1;
  /** 자르기 영역. null이면 원본 전체 */
  crop: Rect | null;
  /** 그리는 순서(뒤 → 앞). 마지막 원소가 맨 위 */
  objects: EditorObject[];
  /** 다음에 만들 번호 표시의 번호 - 1 */
  badgeCounter: number;
  stamp: { position: StampPosition; dateFormat: StampDateFormat };
}

export function emptyDoc(stamp: EditorDoc['stamp']): EditorDoc {
  return { version: 1, crop: null, objects: [], badgeCounter: 0, stamp: { ...stamp } };
}
