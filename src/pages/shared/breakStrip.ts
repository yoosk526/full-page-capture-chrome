// 긴 그림을 세로로 보여 주고, 나뉘는 곳(파란 선)을 끌어 고치거나 ×로 합치는 칸.
// PDF 미리보기(쪽 나누기)와 긴 캡처 나눌 곳 고르기(Issue #7)가 같이 쓴다.
import { moveBreak, removeBreak, stepStripZoom } from '../../core/pdf';
import { t } from '../../shared/i18n';
import { icons } from '../../shared/icons';
import './pdfPreview.css';

/** 확대 100%일 때 그림 폭 (CSS px) */
const STRIP_W = 300;
/** 캔버스 한 변의 한계보다 작게 */
const MAX_CANVAS_SIDE = 30000;

export interface BreakStripOptions {
  /** 요소 id 앞부분 (예: "pdfp" → pdfp-left, pdfp-strip, pdfp-zoom-in …) */
  idPrefix: string;
  /** 그림 전체 크기(px) */
  imageW: number;
  imageH: number;
  /** 그림을 (w, h) 크기로 그린다 */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** 한 칸(쪽·장)에 들어가는 최대 높이(px) */
  sliceH: number;
  /** 한 칸의 최소 높이(px) */
  minH?: number;
  /** 나뉘는 선을 옮긴 뒤 뒤쪽을 다시 나눌 때 줄과 줄 사이를 찾는 함수 */
  findBreak?: (idealEnd: number, minEnd: number) => number;
  /** 선 이름표 (n은 그 선에서 시작하는 칸 번호) */
  label: (n: number) => string;
  mergeTitle: string;
  cantMergeTitle: string;
  /** 나뉘는 곳이 바뀔 때마다 (끄는 중에도) */
  onChange: () => void;
}

export class BreakStrip {
  readonly el: HTMLElement;
  breaks: number[] = [];
  private readonly wrap: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private zoom = 1;
  private k = 1;

  constructor(private opts: BreakStripOptions) {
    this.el = document.createElement('div');
    this.el.className = 'pdfp-left';
    this.el.innerHTML = `
      <div class="pdfp-zoom">
        <button class="icon-btn" data-zoom="-1"></button>
        <span class="pdfp-zoom-label"></span>
        <button class="icon-btn" data-zoom="1"></button>
      </div>
      <div class="pdfp-strip-wrap"><div class="pdfp-strip"><canvas></canvas></div></div>`;
    this.wrap = this.el.querySelector('.pdfp-strip-wrap')!;
    this.strip = this.el.querySelector('.pdfp-strip')!;
    this.canvas = this.el.querySelector('canvas')!;
    const id = opts.idPrefix;
    this.el.id = `${id}-left`;
    this.wrap.id = `${id}-strip-wrap`;
    this.strip.id = `${id}-strip`;
    this.el.querySelector('.pdfp-zoom-label')!.id = `${id}-zoom-label`;
    this.el.querySelector('[data-zoom="1"]')!.id = `${id}-zoom-in`;
    this.el.querySelector('[data-zoom="-1"]')!.id = `${id}-zoom-out`;
    const P = t.pdfPreview;
    for (const b of Array.from(this.el.querySelectorAll<HTMLButtonElement>('[data-zoom]'))) {
      const dir = Number(b.dataset.zoom) as 1 | -1;
      b.innerHTML = dir > 0 ? icons.plus : icons.minus;
      b.title = `${dir > 0 ? P.zoomIn : P.zoomOut} · ${P.zoomHint}`;
      b.addEventListener('click', () => this.setZoom(stepStripZoom(this.zoom, dir)));
    }
    // Cmd(Ctrl)+휠로 확대·축소 (Issue #5)
    this.wrap.addEventListener(
      'wheel',
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        this.setZoom(stepStripZoom(this.zoom, e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );
  }

  /** 그림·한계가 바뀌었을 때 (예: PDF 용지 바꾸기) */
  reset(opts: Partial<BreakStripOptions>, breaks: number[]): void {
    this.opts = { ...this.opts, ...opts };
    this.breaks = breaks;
    this.strip.querySelectorAll('.pdfp-break').forEach((el) => el.remove());
    this.drawImage();
    this.renderLines();
  }

  setBreaks(breaks: number[]): void {
    this.breaks = breaks;
    this.renderLines();
  }

  private setZoom(z: number): void {
    if (z === this.zoom) return;
    const w = this.wrap;
    const fy = (w.scrollTop + w.clientHeight / 2) / Math.max(1, w.scrollHeight);
    const fx = (w.scrollLeft + w.clientWidth / 2) / Math.max(1, w.scrollWidth);
    this.zoom = z;
    this.drawImage();
    this.renderLines();
    w.scrollTop = fy * w.scrollHeight - w.clientHeight / 2;
    w.scrollLeft = fx * w.scrollWidth - w.clientWidth / 2;
  }

  private drawImage(): void {
    const { imageW, imageH } = this.opts;
    const cssW = STRIP_W * this.zoom;
    this.k = cssW / imageW;
    const cssH = imageH * this.k;
    const res = Math.min(devicePixelRatio || 1, MAX_CANVAS_SIDE / cssH, MAX_CANVAS_SIDE / cssW);
    this.canvas.width = Math.round(cssW * res);
    this.canvas.height = Math.max(1, Math.round(cssH * res));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.strip.style.width = `${cssW}px`;
    this.strip.style.height = `${cssH}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    this.opts.draw(ctx, this.canvas.width, this.canvas.height);
    this.el.querySelector('.pdfp-zoom-label')!.textContent = `${Math.round(this.zoom * 100)}%`;
    for (const b of Array.from(this.el.querySelectorAll<HTMLButtonElement>('[data-zoom]'))) {
      b.disabled = stepStripZoom(this.zoom, Number(b.dataset.zoom) as 1 | -1) === this.zoom;
    }
  }

  /** 나뉘는 선. 끄는 중인 선(포인터를 잡고 있음)이 지워지지 않도록 있는 요소를 고쳐 쓴다 */
  private renderLines(): void {
    const { imageH, sliceH } = this.opts;
    const lines = Array.from(this.strip.querySelectorAll<HTMLElement>('.pdfp-break'));
    lines.slice(this.breaks.length).forEach((el) => el.remove());
    this.breaks.forEach((b, i) => {
      const line = lines[i] ?? this.makeLine(i);
      line.style.top = `${b * this.k}px`;
      const merge = line.querySelector<HTMLButtonElement>('.pdfp-merge')!;
      const merged = removeBreak(this.breaks, i, imageH, sliceH);
      merge.disabled = !merged;
      merge.title = merged ? this.opts.mergeTitle : this.opts.cantMergeTitle;
    });
  }

  private makeLine(i: number): HTMLElement {
    const line = document.createElement('div');
    line.className = 'pdfp-break';
    line.dataset.index = String(i);
    const label = document.createElement('span');
    label.className = 'pdfp-break-label';
    label.textContent = `↕ ${this.opts.label(i + 2)}`;
    const merge = document.createElement('button');
    merge.className = 'pdfp-merge';
    merge.innerHTML = icons.close;
    merge.addEventListener('pointerdown', (e) => e.stopPropagation());
    merge.addEventListener('click', () => {
      const next = removeBreak(this.breaks, i, this.opts.imageH, this.opts.sliceH);
      if (next) {
        this.breaks = next;
        this.renderLines();
        this.opts.onChange();
      }
    });
    line.append(label, merge);
    line.addEventListener('pointerdown', (e) => this.startDrag(e, i, line));
    this.strip.appendChild(line);
    return line;
  }

  private startDrag(e: PointerEvent, index: number, line: HTMLElement): void {
    e.preventDefault();
    line.setPointerCapture(e.pointerId);
    line.classList.add('dragging');
    const start = this.breaks.slice();
    let raf = 0;
    const onMove = (ev: PointerEvent) => {
      const y = (ev.clientY - this.strip.getBoundingClientRect().top) / this.k;
      const { imageH, sliceH, findBreak, minH } = this.opts;
      this.breaks = moveBreak(start, index, y, imageH, sliceH, findBreak, minH);
      line.style.top = `${this.breaks[index] * this.k}px`;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          this.renderLines();
          this.opts.onChange();
        });
    };
    const onUp = () => {
      line.removeEventListener('pointermove', onMove);
      line.removeEventListener('pointerup', onUp);
      line.removeEventListener('pointercancel', onUp);
      if (raf) cancelAnimationFrame(raf);
      line.classList.remove('dragging');
      this.renderLines();
      this.opts.onChange();
    };
    line.addEventListener('pointermove', onMove);
    line.addEventListener('pointerup', onUp);
    line.addEventListener('pointercancel', onUp);
  }
}
