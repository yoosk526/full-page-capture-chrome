// PDF 만들기 (EXP-02, EXP-03, SET-20 ~ SET-23). 외부 라이브러리 없이 JPEG 그림을 페이지에 붙인다.
import type { PdfOrientation, PdfPaper } from './settings';

/** 용지 크기(pt, 1pt = 1/72인치) */
export const PAPER_SIZE_PT: Record<Exclude<PdfPaper, 'full'>, [number, number]> = {
  letter: [612, 792], // 8.5 x 11인치
  legal: [612, 1008], // 8.5 x 14인치
  a4: [595.28, 841.89], // 210 x 297mm
};
/** 용지 여백(pt). TODO(미확인): 기존 프로그램의 여백은 모름. 0.5인치 */
export const PAGE_MARGIN_PT = 36;
/** "이미지 한 장" 용지에서 픽셀 → pt 비율 (96dpi 기준) */
export const PX_TO_PT = 0.75;
/** 똑똑한 페이지 나누기가 줄 사이를 찾는 범위(한 페이지 높이에 대한 비율). TODO(미확인) */
export const SMART_BREAK_WINDOW = 0.2;

export interface Slice {
  /** 결과 이미지에서 이 페이지가 시작하는 위치(px) */
  y: number;
  h: number;
}

/**
 * 긴 이미지를 페이지 높이에 맞춰 위에서부터 나눈다.
 * @param findBreak 똑똑한 페이지 나누기(SET-21). 이상적인 끝 위치와 허용 최소 위치를 받아 실제 끝 위치를 돌려준다
 */
export function pageSlices(
  totalH: number,
  sliceH: number,
  findBreak?: (idealEnd: number, minEnd: number) => number,
  start = 0,
): Slice[] {
  if (!(sliceH >= 1)) throw new RangeError('sliceH must be >= 1');
  const out: Slice[] = [];
  let y = start;
  while (y < totalH) {
    const ideal = y + sliceH;
    let end = Math.min(totalH, ideal);
    if (findBreak && ideal < totalH) {
      const minEnd = Math.ceil(ideal - sliceH * SMART_BREAK_WINDOW);
      const b = findBreak(ideal, minEnd);
      if (b > y && b >= minEnd && b <= ideal) end = b;
    }
    out.push({ y, h: end - y });
    y = end;
  }
  return out;
}

/**
 * 줄과 줄 사이(한 가지 색으로 된 가로줄)를 찾는다. 이상적인 위치에서 위로 올라가며 찾고,
 * 범위 안에 없으면 이상적인 위치를 그대로 쓴다.
 * TODO(미확인): 기존 프로그램이 줄 사이를 찾는 방법은 모른다.
 * @param isBlankRow y번째 가로줄이 한 가지 색인지
 */
export function findRowGap(idealEnd: number, minEnd: number, isBlankRow: (y: number) => boolean): number {
  for (let y = idealEnd - 1; y >= minEnd; y--) if (isBlankRow(y)) return y + 1;
  return idealEnd;
}

/** RGBA 픽셀 데이터에서 가로줄마다 한 가지 색인지 판정한다 (허용 오차 tolerance) */
export function blankRows(data: Uint8ClampedArray, width: number, height: number, tolerance = 10): boolean[] {
  const rows: boolean[] = [];
  for (let y = 0; y < height; y++) {
    const o = y * width * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    let blank = true;
    for (let x = 1; x < width && blank; x++) {
      const i = o + x * 4;
      if (Math.abs(data[i] - r) > tolerance || Math.abs(data[i + 1] - g) > tolerance || Math.abs(data[i + 2] - b) > tolerance) blank = false;
    }
    rows.push(blank);
  }
  return rows;
}

// ---- 미리보기에서 나누는 곳 고치기 (PR #1 세 번째 요청) ----

/** 한 페이지에 남겨야 하는 가장 작은 이미지 높이(px). TODO(추정) */
export const PAGE_MIN_PX = 20;

/** 나누는 곳 목록(2쪽부터 각 쪽이 시작하는 위치) → 페이지 목록 */
export function slicesFromBreaks(breaks: readonly number[], totalH: number): Slice[] {
  const ys = [0, ...breaks, totalH];
  return ys.slice(0, -1).map((y, i) => ({ y, h: ys[i + 1] - y }));
}

/** 페이지 목록 → 나누는 곳 목록 */
export function breaksFromSlices(slices: readonly Slice[]): number[] {
  return slices.slice(1).map((s) => s.y);
}

/**
 * index번째 나누는 곳을 y로 옮긴다. 앞 쪽이 한 페이지에 들어가는 높이를 넘거나 너무 작아지지 않게 맞추고,
 * 뒤쪽 나누는 곳은 그대로 쓸 수 있으면 두고, 쓸 수 없으면 거기서부터 다시 나눈다.
 */
export function moveBreak(
  breaks: readonly number[],
  index: number,
  y: number,
  totalH: number,
  sliceH: number,
  findBreak?: (idealEnd: number, minEnd: number) => number,
  minH: number = PAGE_MIN_PX,
): number[] {
  const prev = index > 0 ? breaks[index - 1] : 0;
  const hi = Math.min(prev + sliceH, totalH - minH);
  const at = Math.round(Math.min(Math.max(y, prev + minH), hi));
  const out = [...breaks.slice(0, index), at];
  let cur = at;
  for (const b of breaks.slice(index + 1)) {
    if (b - cur < minH || b - cur > sliceH) break;
    out.push(b);
    cur = b;
  }
  const keptAll = out.length === breaks.length;
  if (keptAll && totalH - cur <= sliceH) return out;
  // 남은 부분을 다시 나눈다
  const rest = pageSlices(totalH, sliceH, findBreak, cur).slice(1).map((sl) => sl.y);
  return [...out, ...rest];
}

/**
 * index번째 나누는 곳을 없애 앞뒤 두 쪽을 합친다.
 * @returns 합친 쪽이 한 페이지에 들어가지 않으면 null
 */
export function removeBreak(breaks: readonly number[], index: number, totalH: number, sliceH: number): number[] | null {
  const prev = index > 0 ? breaks[index - 1] : 0;
  const next = index + 1 < breaks.length ? breaks[index + 1] : totalH;
  if (next - prev > sliceH) return null;
  return breaks.filter((_, i) => i !== index);
}

/**
 * 가로줄 픽셀(RGBA)에서 가장 많이 쓰인 색 (비슷한 색은 묶는다).
 * 페이지 아래 남는 여백을 이 색으로 채워 이미지와 이어 보이게 한다 (PR #1 세 번째 요청).
 */
export function dominantColor(data: Uint8ClampedArray): [number, number, number] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    let e = buckets.get(key);
    if (!e) buckets.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++;
    e.r += data[i];
    e.g += data[i + 1];
    e.b += data[i + 2];
    if (!best || e.n > best.n) best = e;
  }
  if (!best) return [255, 255, 255];
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

export interface PageGeometry {
  pageW: number;
  pageH: number;
  /** 그림이 놓이는 왼쪽 위 위치(pt, 위에서부터) */
  originX: number;
  originY: number;
  /** pt / px */
  scale: number;
  /** 한 페이지에 들어가는 이미지 높이(px) */
  sliceH: number;
}

/**
 * 용지와 방향(PR #1 요청)에 따른 페이지 배치. "전체 이미지"는 방향과 관계없이 이미지 크기 그대로다.
 * 가로 방향은 용지의 가로·세로를 바꾼다.
 */
export function pageGeometry(paper: PdfPaper, imageW: number, imageH: number, orientation: PdfOrientation = 'portrait'): PageGeometry {
  if (paper === 'full') {
    return { pageW: imageW * PX_TO_PT, pageH: imageH * PX_TO_PT, originX: 0, originY: 0, scale: PX_TO_PT, sliceH: imageH };
  }
  const [shortSide, longSide] = PAPER_SIZE_PT[paper];
  const [pageW, pageH] = orientation === 'landscape' ? [longSide, shortSide] : [shortSide, longSide];
  const scale = (pageW - PAGE_MARGIN_PT * 2) / imageW;
  const sliceH = Math.max(1, Math.floor((pageH - PAGE_MARGIN_PT * 2) / scale));
  return { pageW, pageH, originX: PAGE_MARGIN_PT, originY: PAGE_MARGIN_PT, scale, sliceH };
}

// ---- 링크 (SET-22) ----

export interface OutLink {
  x: number;
  y: number;
  w: number;
  h: number;
  href: string;
}

/**
 * 원본 이미지 기준 링크 위치를 결과 이미지(자르기·도장·PDF 머리글 반영) 기준으로 바꾼다.
 * 자른 영역 밖의 링크는 버리고, 걸친 링크는 영역 안쪽만 남긴다.
 */
export function mapLinks(
  links: OutLink[],
  crop: { x: number; y: number; w: number; h: number },
  offsetY: number,
): OutLink[] {
  const out: OutLink[] = [];
  for (const l of links) {
    const x0 = Math.max(l.x, crop.x);
    const y0 = Math.max(l.y, crop.y);
    const x1 = Math.min(l.x + l.w, crop.x + crop.w);
    const y1 = Math.min(l.y + l.h, crop.y + crop.h);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({ x: x0 - crop.x, y: y0 - crop.y + offsetY, w: x1 - x0, h: y1 - y0, href: l.href });
  }
  return out;
}

/** 한 페이지(slice)에 걸친 링크를 그 페이지의 pt 좌표로 바꾼다 */
export function linksForSlice(links: OutLink[], slice: Slice, g: PageGeometry): PdfLink[] {
  const out: PdfLink[] = [];
  for (const l of links) {
    const y0 = Math.max(l.y, slice.y);
    const y1 = Math.min(l.y + l.h, slice.y + slice.h);
    if (y1 <= y0) continue;
    out.push({
      x: g.originX + l.x * g.scale,
      y: g.originY + (y0 - slice.y) * g.scale,
      w: l.w * g.scale,
      h: (y1 - y0) * g.scale,
      uri: l.href,
    });
  }
  return out;
}

// ---- PDF 파일 쓰기 ----

export interface PdfLink {
  /** 페이지 왼쪽 위 기준(pt) */
  x: number;
  y: number;
  w: number;
  h: number;
  uri: string;
}

export interface PdfPageSpec {
  width: number;
  height: number;
  image: { jpeg: Uint8Array; pxW: number; pxH: number; x: number; y: number; w: number; h: number };
  links: PdfLink[];
  /** 그림보다 먼저 칠할 사각형(pt, 페이지 왼쪽 위 기준). 남는 여백을 이미지 바탕색으로 채울 때 쓴다 */
  fills?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[];
}

const enc = new TextEncoder();
const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** PDF 문자열 안에 넣을 수 있게 고친다. 한글 등 ASCII 밖의 글자는 퍼센트 인코딩한다 */
export function pdfUri(uri: string): string {
  const ascii = /^[\x20-\x7e]*$/.test(uri) ? uri : encodeURI(decodeURISafe(uri));
  return ascii.replace(/[\\()]/g, (c) => `\\${c}`);
}

function decodeURISafe(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

export function buildPdf(pages: PdfPageSpec[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (id: number, body: string | (() => void)) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // 이진 파일 표시

  // 1: Catalog, 2: Pages, 그다음 페이지마다 Page / Contents / Image 3개
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pages.forEach((p, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const im = p.image;
    const annots = p.links
      .map((l) => {
        const y0 = p.height - l.y - l.h;
        return `<< /Type /Annot /Subtype /Link /Rect [${num(l.x)} ${num(y0)} ${num(l.x + l.w)} ${num(y0 + l.h)}] /Border [0 0 0] /A << /S /URI /URI (${pdfUri(l.uri)}) >> >>`;
      })
      .join(' ');
    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R${annots ? ` /Annots [${annots}]` : ''} >>`,
    );
    const fills = (p.fills ?? [])
      .map((f) => `${f.rgb.map((c) => num(c / 255)).join(' ')} rg ${num(f.x)} ${num(p.height - f.y - f.h)} ${num(f.w)} ${num(f.h)} re f `)
      .join('');
    const content = `${fills}q ${num(im.w)} 0 0 ${num(im.h)} ${num(im.x)} ${num(p.height - im.y - im.h)} cm /Im0 Do Q`;
    obj(contentId, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
    obj(imageId, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${im.pxW} /Height ${im.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`);
      push(im.jpeg);
      push('\nendstream');
    });
  });

  const size = 3 + pages.length * 3;
  const xrefAt = length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
