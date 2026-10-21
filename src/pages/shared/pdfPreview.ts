// PDF로 저장하기 전 미리보기 (PR #1 세 번째 요청).
// 페이지가 어디서 나뉘는지 보여 주고, 나뉘는 선을 끌어 고치거나 두 쪽을 합칠 수 있다.
// Issue #5: 왼쪽 그림 확대, 칸 너비 조절, 쪽 크게 보기, 고른 쪽만 저장.
// TODO(추정): 여기서 바꾼 용지·방향은 이번 저장에만 쓰고 설정에는 남기지 않는다 (Q46 답변 ①).
import { breaksFromSlices, resizeSelection, slicesFromBreaks, type Slice } from '../../core/pdf';
import type { PdfMargin, PdfOrientation, PdfPaper, Settings } from '../../core/settings';
import { t } from '../../shared/i18n';
import { icons } from '../../shared/icons';
import type { ShotRecord } from '../../shared/types';
import { buildPdfBlob, planPdf, sliceFillColor, type PdfPlan } from '../../render/exportPdf';
import { BreakStrip } from './breakStrip';
import './pdfPreview.css';

/** 왼쪽 칸 너비 조절 한계 (CSS px). TODO(추정) */
const LEFT_MIN = 240;
const RIGHT_MIN = 260;
/** 오른쪽 페이지 그림의 폭 (CSS px) */
const CARD_W = 150;
const PAPERS: PdfPaper[] = ['full', 'a4', 'letter', 'legal'];

/**
 * 미리보기 창을 띄운다.
 * @returns 저장을 누르면 PDF 파일, 취소하면 null
 */
export function openPdfPreview(rendered: OffscreenCanvas, shot: ShotRecord, settings: Settings): Promise<Blob | null> {
  const P = t.pdfPreview;
  let paper: PdfPaper = settings.pdfPaper;
  let orientation: PdfOrientation = settings.pdfOrientation;
  let margin: PdfMargin = settings.pdfMargin;
  let plan: PdfPlan;
  let breaks: number[] = [];
  /** 오른쪽 쪽마다 저장할지 */
  let picked: boolean[] = [];
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
        <span class="pdfp-label" id="pdfp-margin-label"></span>
        <div class="pdfp-seg" id="pdfp-margin"></div>
        <span class="pdfp-count" id="pdfp-count"></span>
        <button class="btn" id="pdfp-auto"></button>
      </div>
      <div class="pdfp-body" id="pdfp-body">
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
  q('pdfp-margin-label').textContent = P.margin;
  q('pdfp-auto').textContent = P.auto;
  q('pdfp-cancel').textContent = P.cancel;
  q('pdfp-save').textContent = P.save;
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
  for (const m of ['none', 'narrow', 'normal'] as const) {
    const b = document.createElement('button');
    b.dataset.value = m;
    b.textContent = t.options.margins[m];
    q('pdfp-margin').appendChild(b);
  }

  // 왼쪽: 긴 그림과 나뉘는 선 (확대·축소, 선 끌기, ×로 합치기)
  const strip = new BreakStrip({
    idPrefix: 'pdfp',
    imageW: 1,
    imageH: 1,
    draw: (ctx, w, h) => ctx.drawImage(plan.canvas, 0, 0, w, h),
    sliceH: 1,
    label: P.pageLabel,
    mergeTitle: P.merge,
    cantMergeTitle: P.cantMerge,
    onChange: () => {
      breaks = strip.breaks;
      render();
    },
  });
  q('pdfp-body').prepend(strip.el);

  const replan = () => {
    plan = planPdf(rendered, shot, { ...settings, pdfPaper: paper, pdfOrientation: orientation, pdfMargin: margin });
    breaks = breaksFromSlices(plan.slices);
    picked = plan.slices.map(() => true);
    strip.reset({ imageW: plan.canvas.width, imageH: plan.canvas.height, sliceH: plan.g.sliceH, findBreak: plan.findBreak }, breaks);
    render();
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
    root.querySelectorAll<HTMLButtonElement>('#pdfp-margin button').forEach((b) => {
      b.classList.toggle('on', !full && b.dataset.value === margin);
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
    q('pdfp-margin').addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.value as PdfMargin | undefined;
      if (v && v !== margin && paper !== 'full') {
        margin = v;
        replan();
      }
    });
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
      strip.setBreaks(breaks);
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
