// PDF로 저장하기 전 미리보기 (PR #1 세 번째 요청).
// 페이지가 어디서 나뉘는지 보여 주고, 나뉘는 선을 끌어 고치거나 두 쪽을 합칠 수 있다.
// Issue #5: 왼쪽 그림 확대, 칸 너비 조절, 쪽 크게 보기, 고른 쪽만 저장.
// TODO(추정): 여기서 바꾼 용지·방향은 이번 저장에만 쓰고 설정에는 남기지 않는다 (Q46 답변 ①).
import { breaksFromSlices, moveBreak, removeBreak, resizeSelection, slicesFromBreaks, stepStripZoom, type Slice } from '../../core/pdf';
import type { PdfOrientation, PdfPaper, Settings } from '../../core/settings';
import { t } from '../../shared/i18n';
import { icons } from '../../shared/icons';
import type { ShotRecord } from '../../shared/types';
import { buildPdfBlob, planPdf, sliceFillColor, type PdfPlan } from '../../render/exportPdf';
import './pdfPreview.css';

/** 왼쪽 긴 그림의 폭 (CSS px, 확대 100%일 때) */
const STRIP_W = 300;
/** 왼쪽 칸 너비 조절 한계 (CSS px). TODO(추정) */
const LEFT_MIN = 240;
const RIGHT_MIN = 260;
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
  /** 오른쪽 쪽마다 저장할지 */
  let picked: boolean[] = [];
  let stripZoom = 1;
  /** 크게 보기 중인 쪽 번호(0부터). 닫혀 있으면 -1 */
  let viewing = -1;

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
      <div class="pdfp-body" id="pdfp-body">
        <div class="pdfp-left" id="pdfp-left">
          <div class="pdfp-zoom">
            <button class="icon-btn" id="pdfp-zoom-out"></button>
            <span id="pdfp-zoom-label">100%</span>
            <button class="icon-btn" id="pdfp-zoom-in"></button>
          </div>
          <div class="pdfp-strip-wrap" id="pdfp-strip-wrap"><div class="pdfp-strip" id="pdfp-strip"><canvas id="pdfp-strip-canvas"></canvas></div></div>
        </div>
        <div class="pdfp-splitter" id="pdfp-splitter" role="separator" aria-orientation="vertical"></div>
        <div class="pdfp-right">
          <div class="pdfp-selbar">
            <span id="pdfp-sel-count"></span>
            <button class="pdfp-link" id="pdfp-sel-toggle"></button>
          </div>
          <div class="pdfp-pages" id="pdfp-pages"></div>
        </div>
        <div class="pdfp-viewer" id="pdfp-viewer" hidden>
          <div class="pdfp-viewer-head">
            <button class="icon-btn" id="pdfp-viewer-prev"></button>
            <span id="pdfp-viewer-title"></span>
            <button class="icon-btn" id="pdfp-viewer-next"></button>
            <button class="icon-btn pdfp-viewer-close" id="pdfp-viewer-close"></button>
          </div>
          <div class="pdfp-viewer-stage" id="pdfp-viewer-stage"><canvas id="pdfp-viewer-canvas"></canvas></div>
        </div>
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
  q('pdfp-zoom-in').innerHTML = icons.plus;
  q('pdfp-zoom-in').title = `${P.zoomIn} · ${P.zoomHint}`;
  q('pdfp-zoom-out').innerHTML = icons.minus;
  q('pdfp-zoom-out').title = `${P.zoomOut} · ${P.zoomHint}`;
  q('pdfp-splitter').title = P.splitter;
  q('pdfp-viewer-prev').innerHTML = icons.back;
  q('pdfp-viewer-prev').title = P.prev;
  q('pdfp-viewer-next').innerHTML = icons.back;
  q('pdfp-viewer-next').title = P.next;
  q('pdfp-viewer-close').innerHTML = icons.close;
  q('pdfp-viewer-close').title = P.closeViewer;
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
    picked = plan.slices.map(() => true);
    strip.querySelectorAll('.pdfp-break').forEach((el) => el.remove());
    drawStrip();
    render();
  };

  const stripWrap = q('pdfp-strip-wrap');
  const drawStrip = () => {
    const c = plan.canvas;
    const cssW = STRIP_W * stripZoom;
    k = cssW / c.width;
    const cssH = c.height * k;
    const res = Math.min(devicePixelRatio || 1, MAX_CANVAS_SIDE / cssH, MAX_CANVAS_SIDE / cssW);
    stripCanvas.width = Math.round(cssW * res);
    stripCanvas.height = Math.max(1, Math.round(cssH * res));
    stripCanvas.style.width = `${cssW}px`;
    stripCanvas.style.height = `${cssH}px`;
    strip.style.width = `${cssW}px`;
    strip.style.height = `${cssH}px`;
    q('pdfp-zoom-label').textContent = `${Math.round(stripZoom * 100)}%`;
    (q('pdfp-zoom-in') as HTMLButtonElement).disabled = stepStripZoom(stripZoom, 1) === stripZoom;
    (q('pdfp-zoom-out') as HTMLButtonElement).disabled = stepStripZoom(stripZoom, -1) === stripZoom;
    const ctx = stripCanvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, stripCanvas.width, stripCanvas.height);
  };

  /** 왼쪽 그림 확대·축소. 보던 곳이 그대로 보이도록 스크롤을 맞춘다 */
  const setStripZoom = (z: number) => {
    if (z === stripZoom) return;
    const fy = (stripWrap.scrollTop + stripWrap.clientHeight / 2) / Math.max(1, stripWrap.scrollHeight);
    const fx = (stripWrap.scrollLeft + stripWrap.clientWidth / 2) / Math.max(1, stripWrap.scrollWidth);
    stripZoom = z;
    drawStrip();
    render();
    stripWrap.scrollTop = fy * stripWrap.scrollHeight - stripWrap.clientHeight / 2;
    stripWrap.scrollLeft = fx * stripWrap.scrollWidth - stripWrap.clientWidth / 2;
  };

  /** 한 쪽을 실제 PDF 모양(용지, 여백, 남는 곳 채우기)으로 그린다 */
  const drawPage = (cv: HTMLCanvasElement, sl: Slice, cssW: number) => {
    const g = plan.g;
    const s = cssW / g.pageW;
    const res = devicePixelRatio || 1;
    cv.width = Math.round(cssW * res);
    cv.height = Math.round(cssW * (g.pageH / g.pageW) * res);
    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssW * (g.pageH / g.pageW)}px`;
    const ctx = cv.getContext('2d')!;
    ctx.scale(res * s, res * s);
    ctx.imageSmoothingQuality = 'high';
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
  };

  /** 쪽 크게 보기 창 (Esc로 닫고, ←/→로 앞뒤 쪽) */
  const showViewer = (i: number) => {
    const slices = slicesFromBreaks(breaks, plan.canvas.height);
    viewing = Math.max(0, Math.min(slices.length - 1, i));
    const viewer = q('pdfp-viewer');
    viewer.hidden = false;
    q('pdfp-viewer-title').textContent = P.viewerTitle(viewing + 1, slices.length);
    (q('pdfp-viewer-prev') as HTMLButtonElement).disabled = viewing === 0;
    (q('pdfp-viewer-next') as HTMLButtonElement).disabled = viewing === slices.length - 1;
    const stage = q('pdfp-viewer-stage');
    const g = plan.g;
    const cssW = Math.max(120, Math.min(stage.clientWidth - 40, ((stage.clientHeight - 24) * g.pageW) / g.pageH));
    drawPage(q<HTMLCanvasElement>('pdfp-viewer-canvas'), slices[viewing], cssW);
  };
  const hideViewer = () => {
    viewing = -1;
    q('pdfp-viewer').hidden = true;
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
    picked = resizeSelection(picked, slices.length);
    const nPicked = picked.filter(Boolean).length;
    q('pdfp-sel-count').textContent = P.selCount(nPicked, slices.length);
    q('pdfp-sel-toggle').textContent = nPicked === slices.length ? P.selectNone : P.selectAll;
    const save = q<HTMLButtonElement>('pdfp-save');
    if (!save.dataset.busy) {
      save.textContent = nPicked === slices.length ? P.save : P.saveSome(nPicked);
      save.disabled = nPicked === 0;
    }

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

    // 오른쪽: 페이지 모양. 누르면 저장할 쪽으로 고르거나 빼고, 마우스를 올리면 "크게 보기" 버튼이 나온다
    const pages = q('pdfp-pages');
    pages.textContent = '';
    slices.forEach((sl, i) => {
      const card = document.createElement('figure');
      card.className = 'pdfp-card' + (picked[i] ? ' picked' : '');
      card.dataset.index = String(i);
      card.title = P.pick;
      const thumb = document.createElement('div');
      thumb.className = 'pdfp-card-thumb';
      const cv = document.createElement('canvas');
      drawPage(cv, sl, CARD_W);
      const check = document.createElement('span');
      check.className = 'pdfp-card-check';
      check.innerHTML = icons.check;
      const view = document.createElement('button');
      view.className = 'icon-btn pdfp-card-view';
      view.innerHTML = icons.expand;
      view.title = P.view;
      view.setAttribute('aria-label', P.view);
      view.addEventListener('click', (e) => {
        e.stopPropagation();
        showViewer(i);
      });
      thumb.append(cv, check, view);
      card.addEventListener('click', () => {
        picked[i] = !picked[i];
        render();
      });
      const cap = document.createElement('figcaption');
      cap.textContent = P.pageLabel(i + 1);
      card.append(thumb, cap);
      pages.appendChild(card);
    });
    if (viewing >= 0) showViewer(viewing);
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
        // 크게 보기가 열려 있으면 그것만 닫는다 (Issue #5)
        if (viewing >= 0) hideViewer();
        else close(null);
      } else if (viewing >= 0 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        showViewer(viewing + (e.key === 'ArrowLeft' ? -1 : 1));
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
    q('pdfp-zoom-in').addEventListener('click', () => setStripZoom(stepStripZoom(stripZoom, 1)));
    q('pdfp-zoom-out').addEventListener('click', () => setStripZoom(stepStripZoom(stripZoom, -1)));
    stripWrap.addEventListener(
      'wheel',
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setStripZoom(stepStripZoom(stripZoom, e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );
    // 왼쪽·오른쪽 칸 사이를 끌어 너비를 바꾼다 (Issue #5)
    const splitter = q('pdfp-splitter');
    splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      splitter.classList.add('dragging');
      const body = q('pdfp-body').getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const w = Math.max(LEFT_MIN, Math.min(body.width - RIGHT_MIN, ev.clientX - body.left));
        q('pdfp-left').style.width = `${w}px`;
      };
      const up = () => {
        splitter.classList.remove('dragging');
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        splitter.removeEventListener('pointercancel', up);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
      splitter.addEventListener('pointercancel', up);
    });
    q('pdfp-sel-toggle').addEventListener('click', () => {
      const all = picked.every(Boolean);
      picked = picked.map(() => !all);
      render();
    });
    q('pdfp-viewer-prev').addEventListener('click', () => showViewer(viewing - 1));
    q('pdfp-viewer-next').addEventListener('click', () => showViewer(viewing + 1));
    q('pdfp-viewer-close').addEventListener('click', hideViewer);
    q('pdfp-auto').addEventListener('click', () => {
      breaks = breaksFromSlices(plan.slices);
      render();
    });
    q('pdfp-save').addEventListener('click', async () => {
      const save = q<HTMLButtonElement>('pdfp-save');
      const chosen = slicesFromBreaks(breaks, plan.canvas.height).filter((_, i) => picked[i]);
      if (chosen.length === 0) return;
      save.disabled = true;
      save.dataset.busy = '1';
      save.textContent = P.preparing;
      try {
        // 고른 쪽만 저장한다 (Issue #5)
        close(await buildPdfBlob(plan, chosen));
      } catch (err) {
        console.error(err);
        delete save.dataset.busy;
        render();
        throw err;
      }
    });
    document.body.appendChild(root);
    replan();
    q('pdfp-save').focus();
  });
}
