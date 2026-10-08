// 조각 이미지를 이어 붙여 한 장(또는 여러 장)으로 만든다. 서비스 워커의 OffscreenCanvas를 쓴다.
import { splitIntoParts, toDeviceSpan, type Part } from '../core/capturePlan';

export interface StitchedPart {
  image: Blob;
  thumb: Blob;
  width: number;
  height: number;
  y: number;
}

const THUMB_W = 400;
const THUMB_H = 300;

export class Stitcher {
  readonly width: number;
  readonly height: number;
  private readonly parts: Part[];
  private canvases = new Map<number, OffscreenCanvas>();
  private finished = new Map<number, StitchedPart>();

  constructor(
    width: number,
    totalHeight: number,
    private readonly scale: number,
    private readonly background: string,
  ) {
    this.width = width;
    this.height = totalHeight;
    this.parts = splitIntoParts(totalHeight, width);
  }

  get partCount(): number {
    return this.parts.length;
  }

  private canvasFor(i: number): OffscreenCanvas {
    let c = this.canvases.get(i);
    if (!c) {
      c = new OffscreenCanvas(this.width, this.parts[i].height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, c.width, c.height);
      this.canvases.set(i, c);
    }
    return c;
  }

  /** 조각 이미지의 [srcY, srcY+height) (CSS px)를 결과의 destY (CSS px)에 붙인다 */
  draw(bitmap: ImageBitmap, srcYCss: number, heightCss: number, destYCss: number): void {
    if (heightCss <= 0) return;
    const src = toDeviceSpan(srcYCss, heightCss, this.scale);
    const dest = toDeviceSpan(destYCss, heightCss, this.scale);
    const sh = Math.min(src.height, bitmap.height - src.start);
    if (sh <= 0) return;
    this.parts.forEach((part, i) => {
      if (this.finished.has(i)) return;
      if (dest.start >= part.y + part.height || dest.start + dest.height <= part.y) return;
      const ctx = this.canvasFor(i).getContext('2d')!;
      ctx.drawImage(bitmap, 0, src.start, bitmap.width, sh, 0, dest.start - part.y, this.width, dest.height);
    });
  }

  /** 채워진 끝(CSS px)까지 완성된 부분을 PNG로 만들고 캔버스 메모리를 비운다 */
  async flush(coveredUntilCss: number, all = false): Promise<void> {
    const coveredPx = Math.round(coveredUntilCss * this.scale);
    for (let i = 0; i < this.parts.length; i++) {
      if (this.finished.has(i)) continue;
      const part = this.parts[i];
      if (!all && part.y + part.height > coveredPx) continue;
      const canvas = this.canvasFor(i);
      const image = await canvas.convertToBlob({ type: 'image/png' });
      const thumb = await makeThumb(canvas);
      this.finished.set(i, { image, thumb, width: this.width, height: part.height, y: part.y });
      this.canvases.delete(i);
    }
  }

  async finish(): Promise<StitchedPart[]> {
    await this.flush(0, true);
    return this.parts.map((_, i) => this.finished.get(i)!);
  }
}

/** 목록용 썸네일: 페이지 위쪽 부분 (GAL-02) */
async function makeThumb(canvas: OffscreenCanvas): Promise<Blob> {
  const ratio = THUMB_W / canvas.width;
  const h = Math.min(THUMB_H, Math.max(1, Math.round(canvas.height * ratio)));
  const t = new OffscreenCanvas(THUMB_W, h);
  const ctx = t.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, canvas.width, h / ratio, 0, 0, THUMB_W, h);
  return t.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}
