// PDF로 저장 (EXP-02, EXP-03, SET-20 ~ SET-23). 서비스 워커(자동 내려받기)와 화면 양쪽에서 쓴다.
import {
  blankRows,
  buildPdf,
  findRowGap,
  linksForSlice,
  mapLinks,
  pageGeometry,
  pageSlices,
  type PdfPageSpec,
  type Slice,
} from '../core/pdf';
import type { Settings } from '../core/settings';
import { buildStamp, outputLayout, stampHeight } from '../core/stamp';
import type { ShotRecord } from '../shared/types';
import { drawStamp } from './renderDoc';

type Canvas2D = OffscreenCanvasRenderingContext2D;

/** 첫 페이지 맨 위에 주소와 촬영 시각 띠를 붙인다 (SET-23) */
function withHeader(canvas: OffscreenCanvas, shot: ShotRecord): { canvas: OffscreenCanvas; headerH: number } {
  const headerH = stampHeight('top', canvas.width);
  const out = new OffscreenCanvas(canvas.width, canvas.height + headerH);
  const ctx = out.getContext('2d')!;
  const stamp = buildStamp('top', 'datetime', shot.url, new Date(shot.createdAt))!;
  drawStamp(ctx, stamp, 0, 0, canvas.width, headerH);
  ctx.drawImage(canvas, 0, headerH);
  return { canvas: out, headerH };
}

async function jpegBytes(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function renderPdf(rendered: OffscreenCanvas, shot: ShotRecord, settings: Settings): Promise<Blob> {
  let canvas = rendered;
  let headerH = 0;
  if (settings.pdfHeader) ({ canvas, headerH } = withHeader(rendered, shot));
  const L = outputLayout(shot.doc, shot.width, shot.height);
  const links = settings.pdfLinks ? mapLinks(shot.links, L.crop, L.imageY + headerH) : [];
  const paper = settings.pdfPaper;
  const g = pageGeometry(paper, canvas.width, canvas.height, settings.pdfOrientation);
  const ctx = canvas.getContext('2d') as Canvas2D;

  // 똑똑한 페이지 나누기: 페이지 끝 근처의 픽셀만 읽어 한 가지 색인 가로줄을 찾는다 (SET-21)
  const findBreak =
    settings.pdfSmartBreak && paper !== 'full'
      ? (ideal: number, min: number) => {
          const h = ideal - min;
          if (h <= 0) return ideal;
          const rows = blankRows(ctx.getImageData(0, min, canvas.width, h).data, canvas.width, h);
          return findRowGap(ideal, min, (y) => rows[y - min]);
        }
      : undefined;
  const slices: Slice[] = paper === 'full' ? [{ y: 0, h: canvas.height }] : pageSlices(canvas.height, g.sliceH, findBreak);

  const pages: PdfPageSpec[] = [];
  for (const s of slices) {
    const part = new OffscreenCanvas(canvas.width, s.h);
    const pctx = part.getContext('2d')!;
    pctx.fillStyle = '#ffffff';
    pctx.fillRect(0, 0, part.width, part.height);
    pctx.drawImage(canvas, 0, s.y, canvas.width, s.h, 0, 0, canvas.width, s.h);
    pages.push({
      width: g.pageW,
      height: g.pageH,
      image: {
        jpeg: await jpegBytes(part),
        pxW: part.width,
        pxH: part.height,
        x: g.originX,
        y: g.originY,
        w: canvas.width * g.scale,
        h: s.h * g.scale,
      },
      links: linksForSlice(links, s, g),
    });
  }
  return new Blob([buildPdf(pages) as BlobPart], { type: 'application/pdf' });
}
