// 스크롤 캡처의 순수 계산 로직 (Chrome API 없음)
//
// 좌표계
// - CSS px: 페이지 기준 좌표. 조각(chunk)의 원본 위치와 결과 위치를 이 단위로 계산한다.
// - device px: captureVisibleTab 결과 이미지의 픽셀. scale(= 이미지 폭 / 화면 폭)을 곱해 얻는다.
//
// 스크롤 영역(region)
// - 문서 전체가 스크롤되는 일반 페이지: regionTop = 0, regionHeight = 화면 높이
// - 내부 스크롤 영역(웹 메일, 대시보드 등, CAP-07): 그 요소가 화면에서 차지하는 세로 구간

/** 캔버스 한 장의 최대 높이(device px). Chrome의 캔버스 한계(가로·세로 32,767px)와
 * PDF 한 페이지 한계(14,400pt ≈ 19,200px)보다 작게 잡았다. 분할 기준은 [미확인](CAP-08). */
export const MAX_PART_HEIGHT = 16384;
/** 캔버스 한 장의 최대 픽셀 수. Chrome 한계(268,435,456)의 절반으로 메모리 여유를 둔다. */
export const MAX_PART_AREA = 16384 * 8192;

/**
 * 스크롤 위치 목록을 만든다. 조각 수 = ceil(콘텐츠 높이 / 영역 높이) (TODO(추정): 관찰값 기반 추정).
 * 마지막 조각은 맨 아래(콘텐츠 높이 - 영역 높이)로 맞춘다.
 */
export function planScrollPositions(contentHeight: number, regionHeight: number): number[] {
  if (!(regionHeight > 0)) throw new RangeError('regionHeight must be > 0');
  if (!(contentHeight >= 0)) throw new RangeError('contentHeight must be >= 0');
  const maxScroll = Math.max(0, Math.ceil(contentHeight - regionHeight));
  const positions: number[] = [];
  for (let y = 0; y < maxScroll; y += regionHeight) positions.push(y);
  positions.push(maxScroll);
  return positions;
}

export interface RegionMetrics {
  viewportHeight: number;
  regionTop: number;
  regionHeight: number;
  contentHeight: number;
}

/**
 * 찍힌 이미지가 페이지가 알려 준 화면 높이보다 짧으면(기기 흉내 모드, 일부 확대 상태 등)
 * 실제로 찍힌 높이에 맞춰 화면·영역 높이를 줄인다. 그대로 쓰면 조각 사이에 빈 띠가 생긴다.
 */
export function fitToCaptured(m: RegionMetrics, capturedHeight: number): RegionMetrics {
  if (capturedHeight >= m.viewportHeight - 0.5) return m;
  const viewportHeight = capturedHeight;
  const regionTop = Math.min(m.regionTop, viewportHeight - 1);
  const regionHeight = Math.max(1, Math.min(m.regionHeight, viewportHeight - regionTop));
  return { ...m, viewportHeight, regionTop, regionHeight };
}

/** 결과 이미지 전체 높이(CSS px) = 영역 위 + 콘텐츠 + 영역 아래 */
export function outputHeightCss(m: RegionMetrics): number {
  const maxScroll = Math.max(0, Math.ceil(m.contentHeight - m.regionHeight));
  return m.viewportHeight + maxScroll;
}

export interface ChunkPlacement {
  /** 조각 이미지에서 잘라 올 세로 시작 위치 (CSS px, 화면 기준) */
  srcY: number;
  /** 잘라 올 높이 (CSS px). 0이면 새로 붙일 부분이 없다 */
  height: number;
  /** 결과 이미지에서 붙일 위치 (CSS px) */
  destY: number;
  /** 이 조각까지 붙인 뒤 결과 이미지에서 채워진 끝 위치 (CSS px) */
  coveredUntil: number;
}

/**
 * 조각 하나를 결과 이미지 어디에 붙일지 계산한다.
 * 실제 스크롤 위치(actualScroll)를 쓰므로 페이지가 예상보다 덜 스크롤돼도 겹치거나 비지 않는다.
 * - 첫 조각: 화면 맨 위(영역 위쪽 포함)부터
 * - 중간 조각: 영역 안쪽 중 아직 안 붙인 부분만
 * - 마지막 조각: 영역 아래쪽(화면 바닥)까지 포함
 */
export function placeChunk(p: {
  isFirst: boolean;
  isLast: boolean;
  actualScroll: number;
  coveredUntil: number;
  regionTop: number;
  regionHeight: number;
  viewportHeight: number;
}): ChunkPlacement {
  const srcStart = p.isFirst ? 0 : Math.max(p.regionTop, p.coveredUntil - p.actualScroll);
  const srcEnd = p.isLast ? p.viewportHeight : p.regionTop + p.regionHeight;
  const height = Math.max(0, srcEnd - srcStart);
  const destY = srcStart + p.actualScroll;
  return {
    srcY: srcStart,
    height,
    destY,
    coveredUntil: Math.max(p.coveredUntil, destY + height),
  };
}

/**
 * CSS px 구간을 device px 구간으로 바꾼다. 위·아래 끝을 각각 반올림하므로
 * 맞닿은 두 구간(앞 구간의 끝 = 뒤 구간의 시작)은 변환 뒤에도 틈이나 겹침 없이 맞닿는다.
 */
export function toDeviceSpan(startCss: number, heightCss: number, scale: number): { start: number; height: number } {
  const start = Math.round(startCss * scale);
  const end = Math.round((startCss + heightCss) * scale);
  return { start, height: end - start };
}

export interface Part {
  y: number;
  height: number;
}

/**
 * 결과 이미지가 캔버스 한계를 넘으면 위에서부터 여러 장으로 나눈다 (CAP-08).
 * TODO(미확인): 기존 프로그램의 분할 기준은 모른다. 여기서는 한 장의 최대 높이로 자른다.
 */
export function splitIntoParts(
  totalHeight: number,
  width: number,
  maxHeight: number = MAX_PART_HEIGHT,
  maxArea: number = MAX_PART_AREA,
): Part[] {
  if (!(width > 0) || !(totalHeight > 0)) throw new RangeError('width and totalHeight must be > 0');
  const partHeight = Math.min(maxHeight, Math.floor(maxArea / width));
  if (partHeight < 1) throw new RangeError('width exceeds canvas area limit');
  const parts: Part[] = [];
  for (let y = 0; y < totalHeight; y += partHeight) {
    parts.push({ y, height: Math.min(partHeight, totalHeight - y) });
  }
  return parts;
}

/** 배경색이 투명인지 (getComputedStyle 결과 문자열 기준) */
function isTransparent(color: string): boolean {
  const c = color.replace(/\s+/g, '').toLowerCase();
  if (c === '' || c === 'transparent') return true;
  const m = c.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  return m !== null && Number(m[4]) === 0;
}

/**
 * 이어 붙일 바탕색을 고른다 (CAP-09). html → body 순서로 처음 만나는 불투명한 색,
 * 둘 다 투명하면 브라우저 기본인 흰색.
 */
export function pickBackgroundColor(colors: string[]): string {
  for (const c of colors) if (!isTransparent(c)) return c;
  return '#ffffff';
}
