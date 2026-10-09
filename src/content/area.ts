// "페이지 일부" 영역 고르기 (PR #1 요청). 촬영할 탭에 그때그때 넣는다(activeTab).
// 화면을 어둡게 덮고, 마우스로 끈 사각형만 밝게 보여 준다. 손을 떼면 덮개를 지우고 서비스 워커에 영역을 알린다.
import { autoScrollStep } from '../core/area';
import { t } from '../shared/i18n';
import { SCROLLER_ATTR, type AreaSelected } from '../shared/messages';

declare global {
  interface Window {
    __hanjangArea?: boolean;
  }
}

const HOST_ID = '__hanjang-area';

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

function start(): void {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .layer { position: fixed; inset: 0; cursor: crosshair; background: rgba(15, 20, 30, 0.35); }
      .layer.dragging { background: transparent; }
      .box { position: fixed; display: none; border: 2px solid #fff; outline: 1px solid rgba(0,0,0,.5);
             box-shadow: 0 0 0 9999px rgba(15, 20, 30, 0.35); pointer-events: none; }
      .size { position: absolute; left: 0; top: -28px; padding: 3px 8px; border-radius: 999px;
              background: #2b6cde; color: #fff; font: 600 12px system-ui, sans-serif; white-space: nowrap; }
      .hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); padding: 9px 16px;
              border-radius: 999px; background: #2b6cde; color: #fff; font: 500 14px system-ui, sans-serif;
              box-shadow: 0 6px 24px rgba(0,0,0,.25); pointer-events: none; }
    </style>
    <div class="layer"></div>
    <div class="box"><span class="size"></span></div>
    <div class="hint"></div>`;
  const layer = root.querySelector<HTMLElement>('.layer')!;
  const box = root.querySelector<HTMLElement>('.box')!;
  const size = root.querySelector<HTMLElement>('.size')!;
  const hint = root.querySelector<HTMLElement>('.hint')!;
  hint.textContent = t.area.hint;
  document.documentElement.appendChild(host);

  // 스크롤할 대상: 창이 스크롤되면 창, 아니면 누른 곳의 스크롤 상자(웹 메일·대시보드 등)나
  // 페이지 안의 틀(iframe, 네이버 블로그 등). scrollBox는 화면에서 그 대상이 차지한 요소(틀이면 iframe)
  let inner: HTMLElement | null = null;
  let scrollBox: HTMLElement | null = null;
  const scrollPos = () => (inner ? inner.scrollTop : window.scrollY);
  /** 자동 스크롤이 반응하는 위·아래 끝 (화면 기준) */
  const edges = () => {
    if (!inner || !scrollBox) return { top: 0, height: window.innerHeight };
    const r = scrollBox.getBoundingClientRect();
    const top = Math.max(0, r.top + scrollBox.clientTop);
    return { top, height: Math.min(window.innerHeight, top + inner.clientHeight) - top };
  };

  // origin.y와 rect.y는 스크롤을 더한 위치, x는 화면 기준
  let origin: { x: number; y: number } | null = null;
  let pointer = { x: 0, y: 0 };
  let rect = { x: 0, y: 0, w: 0, h: 0 };
  let raf = 0;

  const draw = () => {
    if (!origin) return;
    const py = pointer.y + scrollPos();
    const x = Math.max(0, Math.min(origin.x, pointer.x));
    const right = Math.min(window.innerWidth, Math.max(origin.x, pointer.x));
    const y = Math.max(0, Math.min(origin.y, py));
    rect = { x, y, w: Math.max(0, right - x), h: Math.max(0, Math.max(origin.y, py) - y) };
    Object.assign(box.style, {
      display: 'block',
      left: `${x}px`,
      top: `${y - scrollPos()}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`,
    });
    size.textContent = `${Math.round(rect.w * devicePixelRatio)} x ${Math.round(rect.h * devicePixelRatio)}`;
  };
  // 끄는 중 마우스가 화면 위·아래 끝에 가면 스크롤한다. 끝을 많이 넘을수록 빠르다 (Q43 답변 ②)
  const tick = () => {
    raf = 0;
    if (!origin) return;
    const e = edges();
    const step = autoScrollStep(pointer.y - e.top, e.height);
    if (step !== 0) {
      const before = scrollPos();
      // 페이지가 부드러운 스크롤(scroll-behavior: smooth)을 써도 바로 움직이게 한다
      if (inner) inner.scrollBy({ top: step, behavior: 'instant' });
      else window.scrollBy({ top: step, behavior: 'instant' });
      if (scrollPos() !== before) draw();
    }
    raf = requestAnimationFrame(tick);
  };

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    origin = null;
    host.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  };
  window.addEventListener('keydown', onKey, true);

  layer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    const found = windowScrolls() ? null : scrollerAt(e.clientX, e.clientY, host);
    inner = found?.el ?? null;
    scrollBox = found?.box ?? null;
    origin = { x: e.clientX, y: e.clientY + scrollPos() };
    pointer = { x: e.clientX, y: e.clientY };
    layer.classList.add('dragging');
    hint.style.display = 'none';
    raf = requestAnimationFrame(tick);
  });
  layer.addEventListener('pointermove', (e) => {
    if (!origin) return;
    pointer = { x: e.clientX, y: e.clientY };
    draw();
  });
  layer.addEventListener('pointerup', async () => {
    if (!origin) return;
    cleanup();
    // 덮개가 찍히지 않도록 화면이 다시 그려질 때까지 기다린다
    await nextFrame();
    // 촬영 쪽(content.js)이 같은 스크롤 상자를 쓰도록 표시해 둔다
    document.querySelectorAll(`[${SCROLLER_ATTR}]`).forEach((el) => el.removeAttribute(SCROLLER_ATTR));
    scrollBox?.setAttribute(SCROLLER_ATTR, '');
    const msg: AreaSelected = { kind: 'areaSelected', rect, title: document.title, url: location.href };
    try {
      const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; error?: string } | undefined;
      if (!res) showFailed('no response');
      else if (!res.ok) showFailed(res.error ?? 'unknown');
    } catch (e) {
      showFailed(String(e instanceof Error ? e.message : e));
    }
  });
}

/** 창(문서 전체)이 세로로 스크롤되는지 */
function windowScrolls(): boolean {
  const el = document.scrollingElement ?? document.documentElement;
  if (el.scrollHeight <= window.innerHeight + 1) return false;
  // html의 overflow가 visible이면 body의 overflow가 창에 적용된다
  const html = getComputedStyle(document.documentElement).overflowY;
  const viewport = html === 'visible' && document.body ? getComputedStyle(document.body).overflowY : html;
  return viewport !== 'hidden' && viewport !== 'clip';
}

/** 누른 곳에서 가장 가까운 세로 스크롤 상자. 같은 사이트의 틀(iframe)이면 그 안의 문서를 스크롤한다 */
function scrollerAt(x: number, y: number, host: HTMLElement): { el: HTMLElement; box: HTMLElement } | null {
  const hit = document.elementsFromPoint(x, y).find((el) => el !== host && !host.contains(el));
  for (let el = hit as HTMLElement | null; el && el !== document.documentElement; el = el.parentElement) {
    if (el instanceof HTMLIFrameElement) {
      const doc = frameDocument(el);
      const se = doc?.scrollingElement as HTMLElement | null | undefined;
      if (se && se.scrollHeight > se.clientHeight + 1) return { el: se, box: el };
      continue;
    }
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) return { el, box: el };
  }
  return null;
}

/** 다른 사이트의 틀이면 브라우저가 안을 보지 못하게 막으므로 null */
function frameDocument(f: HTMLIFrameElement): Document | null {
  try {
    return f.contentDocument;
  } catch {
    return null;
  }
}

/** 실패 안내. 원인을 알 수 있게 오류 내용도 함께 보여 준다 (Issue #3: 사용자 화면에서만 실패해 원인을 알아야 함) */
function showFailed(reason: string): void {
  const el = document.createElement('div');
  el.id = '__hanjang-area-failed';
  el.style.cssText =
    'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;max-width:min(640px,90vw);padding:10px 16px;border-radius:14px;background:#d33a2c;color:#fff;font:500 14px/1.5 system-ui,sans-serif;user-select:text;cursor:text';
  const title = document.createElement('div');
  title.textContent = t.area.failed;
  const detail = document.createElement('div');
  detail.textContent = t.area.failedReason(reason);
  detail.style.cssText = 'margin-top:4px;font-size:12px;opacity:.9;word-break:break-all';
  el.append(title, detail);
  document.documentElement.appendChild(el);
  // 원인을 읽고 옮겨 적을 수 있게 오래 보여 주고, 누르면 닫힌다
  const close = () => el.remove();
  setTimeout(close, 15000);
  el.addEventListener('dblclick', close);
}

start();
