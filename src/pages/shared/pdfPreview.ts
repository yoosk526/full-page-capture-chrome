// PDF로 저장하기 전 미리보기 (PR #1 세 번째 요청).
// 페이지가 어디서 나뉘는지 보여 주고, 나뉘는 선을 끌어 고치거나 두 쪽을 합칠 수 있다.
// TODO(추정): 여기서 바꾼 용지·방향은 이번 저장에만 쓰고 설정에는 남기지 않는다.
import { breaksFromSlices, moveBreak, removeBreak, slicesFromBreaks } from '../../core/pdf';
import type { PdfOrientation, PdfPaper, Settings } from '../../core/settings';
import { t } from '../../shared/i18n';
import { icons } from '../../shared/icons';
import type { ShotRecord } from '../../shared/types';
import { buildPdfBlob, planPdf, sliceFillColor, type PdfPlan } from '../../render/exportPdf';
import './pdfPreview.css';

/** 왼쪽 긴 그림의 폭 (CSS px) */
const STRIP_W = 300;
/** 오른쪽 페이지 그림의 폭 (CSS px) */
const CARD_W = 150;
/** 캔버스 한 변의 한계보다 작게 */
const MAX_CANVAS_SIDE = 30000;
const PAPERS: PdfPaper[] = ['full', 'a4', 'letter', 'legal'];

/**
 * 미리보기 창을 띄운다.
 * @returns 저장을 누르면 PDF 파일, 취소하면 null
 */
export function openPdfPreview(rendered: OffscreenCanvas, shot: ShotRecord, settings: Settings): Promise<Blob | null> {
  const P = t.pdfPreview;
  let paper: PdfPaper = settings.pdfPaper;
  let orientation: PdfOrientation = settings.pdfOrientation;
  let plan: PdfPlan;
  let breaks: number[] = [];

  const root = document.createElement('div');
  root.className = 'pdfp-backdrop';
  root.id = 'pdf-preview';
  root.innerHTML = `
    <div class="pdfp" role="dialog" aria-modal="true" aria-labelledby="pdfp-title">
      <div class="pdfp-head">
        <h2 id="pdfp-title"></h2>
        <button class="icon-btn" id="pdfp-close"></button>
      </div>
      <div class="pdfp-tools">
        <span class="pdfp-label" id="pdfp-paper-label"></span>
        <div class="pdfp-seg" id="pdfp-paper"></div>
        <span class="pdfp-label" id="pdfp-orient-label"></span>
        <div class="pdfp-seg" id="pdfp-orient"></div>
        <span class="pdfp-count" id="pdfp-count"></span>
        <button class="btn" id="pdfp-auto"></button>
      </div>
      <div class="pdfp-body">
        <div class="pdfp-strip-wrap"><div class="pdfp-strip" id="pdfp-strip"><canvas id="pdfp-strip-canvas"></canvas></div></div>
        <div class="pdfp-pages" id="pdfp-pages"></div>
      </div>
      <div class="pdfp-foot">
        <p class="pdfp-hint" id="pdfp-hint"></p>
        <button class="btn" id="pdfp-cancel"></button>
        <button class="btn primary" id="pdfp-save"></button>
      </div>
    </div>`;
  const q = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  q('pdfp-title').textContent = P.title;
  q('pdfp-close').innerHTML = icons.close;
  q('pdfp-close').title = t.common.close;
  q('pdfp-paper-label').textContent = P.paper;
  q('pdfp-orient-label').textContent = P.orientation;
  q('pdfp-auto').textContent = P.auto;
  q('pdfp-cancel').textContent = P.cancel;
  q('pdfp-save').textContent = P.save;
  for (const p of PAPERS) {
    const b = document.createElement('button');
    b.dataset.value = p;
    b.textContent = t.options.papers[p].title;
    q('pdfp-paper').appendChild(b);
  }
  for (const o of ['portrait', 'landscape'] as const) {
    const b = document.createElement('button');
    b.dataset.value = o;
    b.textContent = t.options[o];
    q('pdfp-orient').appendChild(b);
  }

  const strip = q('pdfp-strip');
  const stripCanvas = q<HTMLCanvasElement>('pdfp-strip-canvas');
  let k = 1;

  const replan = () => {
    plan = planPdf(rendered, shot, { ...settings, pdfPaper: paper, pdfOrientation: orientation });
    breaks = breaksFromSlices(plan.slices);
    strip.querySelectorAll('.pdfp-break').forEach((el) => el.remove());
    drawStrip();
    render();
  };

  const drawStrip = () => {
    const c = plan.canvas;
    k = STRIP_W / c.width;
    const cssH = c.height * k;
    const res = Math.min(devicePixelRatio || 1, MAX_CANVAS_SIDE / cssH);
    stripCanvas.width = Math.round(STRIP_W * res);
    stripCanvas.height = Math.max(1, Math.round(cssH * res));
    stripCanvas.style.width = `${STRIP_W}px`;
    stripCanvas.style.height = `${cssH}px`;
    strip.style.height = `${cssH}px`;
    const ctx = stripCanvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, stripCanvas.width, stripCanvas.height);
  };

  const render = () => {
    const full = paper === 'full';
    root.querySelectorAll<HTMLButtonElement>('#pdfp-paper button').forEach((b) => b.classList.toggle('on', b.dataset.value === paper));
    root.querySelectorAll<HTMLButtonElement>('#pdfp-orient button').forEach((b) => {
      b.classList.toggle('on', !full && b.dataset.value === orientation);
      b.disabled = full;
    });
    (q('pdfp-auto') as HTMLButtonElement).disabled = full;
    q('pdfp-hint').textContent = full ? P.hintFull : P.hint;
    const slices = slicesFromBreaks(breaks, plan.canvas.height);
    q('pdfp-count').textContent = P.pages(slices.length);

    // 왼쪽: 나뉘는 선. 끄는 중인 선(포인터를 잡고 있음)이 지워지지 않도록 있는 요소를 고쳐 쓴다
    const lines = Array.from(strip.querySelectorAll<HTMLElement>('.pdfp-break'));
    lines.slice(breaks.length).forEach((el) => el.remove());
    breaks.forEach((b, i) => {
      const line = lines[i] ?? makeLine(i);
      line.style.top = `${b * k}px`;
      const merge = line.querySelector<HTMLButtonElement>('.pdfp-merge')!;
      const merged = removeBreak(breaks, i, plan.canvas.height, plan.g.sliceH);
      merge.disabled = !merged;
      merge.title = merged ? P.merge : P.cantMerge;
    });

    // 오른쪽: 페이지 모양
    const pages = q('pdfp-pages');
    pages.textContent = '';
    const g = plan.g;
    const s = CARD_W / g.pageW;
    slices.forEach((sl, i) => {
      const card = document.createElement('figure');
      card.className = 'pdfp-card';
      const cv = document.createElement('canvas');
      const res = devicePixelRatio || 1;
      cv.width = Math.round(CARD_W * res);
      cv.height = Math.round(CARD_W * (g.pageH / g.pageW) * res);
      cv.style.width = `${CARD_W}px`;
      cv.style.height = `${CARD_W * (g.pageH / g.pageW)}px`;
      const ctx = cv.getContext('2d')!;
      ctx.scale(res * s, res * s);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, g.pageW, g.pageH);
      const w = plan.canvas.width * g.scale;
      const h = sl.h * g.scale;
      const leftover = g.pageH - g.originY * 2 - h;
      if (leftover > 0.5) {
        const [r, gg, b] = sliceFillColor(plan.canvas, sl);
        ctx.fillStyle = `rgb(${r}, ${gg}, ${b})`;
        ctx.fillRect(g.originX, g.originY + h - 1, w, leftover + 1);
      }
      ctx.drawImage(plan.canvas, 0, sl.y, plan.canvas.width, sl.h, g.originX, g.originY, w, h);
      const cap = document.createElement('figcaption');
      cap.textContent = P.pageLabel(i + 1);
      card.append(cv, cap);
      pages.appendChild(card);
    });
  };

  const makeLine = (i: number): HTMLElement => {
    const line = document.createElement('div');
    line.className = 'pdfp-break';
    line.dataset.index = String(i);
    const label = document.createElement('span');
    label.className = 'pdfp-break-label';
    label.textContent = `↕ ${P.pageLabel(i + 2)}`;
    const merge = document.createElement('button');
    merge.className = 'pdfp-merge';
    merge.innerHTML = icons.close;
    merge.addEventListener('pointerdown', (e) => e.stopPropagation());
    merge.addEventListener('click', () => {
      const next = removeBreak(breaks, i, plan.canvas.height, plan.g.sliceH);
      if (next) {
        breaks = next;
        render();
      }
    });
    line.append(label, merge);
    line.addEventListener('pointerdown', (e) => startDrag(e, i, line));
    strip.appendChild(line);
    return line;
  };

  const startDrag = (e: PointerEvent, index: number, line: HTMLElement) => {
    e.preventDefault();
    line.setPointerCapture(e.pointerId);
    line.classList.add('dragging');
    const start = breaks.slice();
    let raf = 0;
    const onMove = (ev: PointerEvent) => {
      const y = (ev.clientY - strip.getBoundingClientRect().top) / k;
      breaks = moveBreak(start, index, y, plan.canvas.height, plan.g.sliceH, plan.findBreak);
      line.style.top = `${breaks[index] * k}px`;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          render();
        });
    };
    const onUp = () => {
      line.removeEventListener('pointermove', onMove);
      line.removeEventListener('pointerup', onUp);
      line.removeEventListener('pointercancel', onUp);
      if (raf) cancelAnimationFrame(raf);
      line.classList.remove('dragging');
      render();
    };
    line.addEventListener('pointermove', onMove);
    line.addEventListener('pointerup', onUp);
    line.addEventListener('pointercancel', onUp);
  };

  return new Promise((resolve) => {
    const close = (result: Blob | null) => {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    q('pdfp-close').addEventListener('click', () => close(null));
    q('pdfp-cancel').addEventListener('click', () => close(null));
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) close(null);
    });
    q('pdfp-paper').addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.value as PdfPaper | undefined;
      if (v && v !== paper) {
        paper = v;
        replan();
      }
    });
    q('pdfp-orient').addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.value as PdfOrientation | undefined;
      if (v && v !== orientation && paper !== 'full') {
        orientation = v;
        replan();
      }
    });
    q('pdfp-auto').addEventListener('click', () => {
      breaks = breaksFromSlices(plan.slices);
      render();
    });
    q('pdfp-save').addEventListener('click', async () => {
      const save = q<HTMLButtonElement>('pdfp-save');
      save.disabled = true;
      save.textContent = P.preparing;
      try {
        close(await buildPdfBlob(plan, slicesFromBreaks(breaks, plan.canvas.height)));
      } catch (err) {
        console.error(err);
        save.disabled = false;
        save.textContent = P.save;
        throw err;
      }
    });
    document.body.appendChild(root);
    replan();
    q('pdfp-save').focus();
  });
}
