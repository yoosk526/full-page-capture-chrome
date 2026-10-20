// 긴 캡처가 여러 장으로 나뉘었을 때 나눌 곳을 고르는 창 (Issue #7).
// 왼쪽에 모든 장을 이어 붙인 그림과 나뉘는 선을 보여 주고, 선을 옮기면 그 위치로 다시 잘라 보관한다.
import { SPLIT_MIN_PX, maxPartHeight, regroupSegments, type Part } from '../../core/capturePlan';
import { breaksFromSlices, slicesFromBreaks } from '../../core/pdf';
import { deleteShots, newId, putShot } from '../../shared/db';
import { t } from '../../shared/i18n';
import { icons } from '../../shared/icons';
import type { LinkRect, ShotRecord } from '../../shared/types';
import { makeThumb } from '../../background/stitcher';
import { BreakStrip } from '../shared/breakStrip';

/**
 * 창을 띄운다.
 * @returns "이렇게 나누기"를 누르면 새로 보관한 장들, 아니면 null
 */
export async function openSplitDialog(group: ShotRecord[]): Promise<ShotRecord[] | null> {
  const R = t.result;
  const width = group[0].width;
  const bitmaps = await Promise.all(group.map((s) => createImageBitmap(s.image)));
  // 원래 장들을 위에서부터 이어 본 위치
  const parts: Part[] = [];
  let y = 0;
  for (const s of group) {
    parts.push({ y, height: s.height });
    y += s.height;
  }
  const totalH = y;
  const sliceH = maxPartHeight(width);
  const original = breaksFromSlices(parts.map((p) => ({ y: p.y, h: p.height })));
  let breaks = original.slice();

  const root = document.createElement('div');
  root.className = 'pdfp-backdrop';
  root.id = 'split-dialog';
  root.innerHTML = `
    <div class="pdfp" role="dialog" aria-modal="true" aria-labelledby="split-title">
      <div class="pdfp-head">
        <h2 id="split-title"></h2>
        <button class="icon-btn" id="split-close"></button>
      </div>
      <div class="pdfp-body" id="split-body">
        <div class="pdfp-right split-info">
          <p class="split-intro" id="split-intro"></p>
          <div class="pdfp-selbar"><span id="split-count"></span></div>
          <ul class="split-list" id="split-list"></ul>
        </div>
      </div>
      <div class="pdfp-foot">
        <button class="btn" id="split-auto"></button>
        <span class="pdfp-hint"></span>
        <button class="btn" id="split-keep"></button>
        <button class="btn primary" id="split-apply"></button>
      </div>
    </div>`;
  const q = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  q('split-title').textContent = R.splitTitle;
  q('split-close').innerHTML = icons.close;
  q('split-close').title = t.common.close;
  q('split-intro').textContent = R.splitIntro(group.length, sliceH);
  q('split-auto').textContent = R.splitAuto;
  q('split-keep').textContent = R.splitKeep;
  q('split-apply').textContent = R.splitApply;

  const render = () => {
    const slices = slicesFromBreaks(breaks, totalH);
    q('split-count').textContent = R.splitCount(slices.length);
    const list = q('split-list');
    list.textContent = '';
    slices.forEach((sl, i) => {
      const li = document.createElement('li');
      li.textContent = R.splitPartRow(i + 1, width, sl.h);
      list.appendChild(li);
    });
    const same = breaks.length === original.length && breaks.every((b, i) => b === original[i]);
    (q('split-apply') as HTMLButtonElement).disabled = same;
    (q('split-auto') as HTMLButtonElement).disabled = same;
  };

  const strip = new BreakStrip({
    idPrefix: 'split',
    imageW: width,
    imageH: totalH,
    draw: (ctx, w, h) => {
      const k = h / totalH;
      parts.forEach((p, i) => ctx.drawImage(bitmaps[i], 0, p.y * k, w, p.height * k));
    },
    sliceH,
    minH: SPLIT_MIN_PX,
    label: R.splitPartLabel,
    mergeTitle: R.splitMerge,
    cantMergeTitle: R.splitCantMerge,
    onChange: () => {
      breaks = strip.breaks;
      render();
    },
  });
  q('split-body').prepend(strip.el);

  return new Promise((resolve) => {
    const close = (result: ShotRecord[] | null) => {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      bitmaps.forEach((b) => b.close());
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
    q('split-close').addEventListener('click', () => close(null));
    q('split-keep').addEventListener('click', () => close(null));
    q('split-auto').addEventListener('click', () => {
      breaks = original.slice();
      strip.setBreaks(breaks);
      render();
    });
    q('split-apply').addEventListener('click', async () => {
      const apply = q<HTMLButtonElement>('split-apply');
      apply.disabled = true;
      apply.textContent = R.splitApplying;
      try {
        close(await regroup(group, bitmaps, parts, slicesFromBreaks(breaks, totalH)));
      } catch (err) {
        console.error(err);
        apply.disabled = false;
        apply.textContent = R.splitApply;
        throw err;
      }
    });
    document.body.appendChild(root);
    strip.reset({}, breaks);
    render();
    q('split-apply').focus();
  });
}

/** 고른 위치로 다시 잘라 새 장들을 보관하고, 원래 장들은 지운다 */
async function regroup(group: ShotRecord[], bitmaps: ImageBitmap[], parts: Part[], slices: { y: number; h: number }[]): Promise<ShotRecord[]> {
  const width = group[0].width;
  const groupId = newId();
  // 링크는 이어 본 위치로 바꿔 두었다가 새 장마다 다시 나눈다
  const links: LinkRect[] = group.flatMap((s, i) => s.links.map((l) => ({ ...l, y: l.y + parts[i].y })));
  const out: ShotRecord[] = [];
  for (const [i, sl] of slices.entries()) {
    const canvas = new OffscreenCanvas(width, sl.h);
    const ctx = canvas.getContext('2d')!;
    for (const seg of regroupSegments(parts, sl)) {
      ctx.drawImage(bitmaps[seg.part], 0, seg.srcY, width, seg.height, 0, seg.destY, width, seg.height);
    }
    out.push({
      ...group[0],
      id: newId(),
      groupId,
      partIndex: i,
      partCount: slices.length,
      width,
      height: sl.h,
      image: await canvas.convertToBlob({ type: 'image/png' }),
      thumb: await makeThumb(canvas),
      doc: structuredClone(group[0].doc),
      links: links
        .filter((l) => l.y < sl.y + sl.h && l.y + l.h > sl.y)
        .map((l) => {
          const top = Math.max(l.y, sl.y);
          const bottom = Math.min(l.y + l.h, sl.y + sl.h);
          return { ...l, y: top - sl.y, h: bottom - top };
        }),
      splitChosen: true,
    });
  }
  for (const s of out) await putShot(s);
  await deleteShots(group.map((s) => s.id));
  return out;
}
