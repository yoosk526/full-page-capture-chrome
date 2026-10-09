// 촬영하는 페이지 안에서 실행된다 (chrome.scripting.executeScript로 그때그때 넣음, activeTab 권한)
// 스크롤, 고정 요소 숨기기, 크기 측정을 맡는다. 실제 촬영(captureVisibleTab)은 서비스 워커가 한다.
import { pickBackgroundColor } from '../core/capturePlan';
import { SCROLLER_ATTR, type ContentRequest, type PageMetrics } from '../shared/messages';

declare global {
  interface Window {
    __hanjangCapture?: boolean;
  }
}

interface SavedStyle {
  el: HTMLElement;
  prop: string;
  value: string;
  priority: string;
}

/** 내부 스크롤 영역(CAP-07). null이면 문서 전체를 스크롤한다 */
let target: HTMLElement | null = null;
let fixedEls: HTMLElement[] = [];
let saved: SavedStyle[] = [];
let originalScroll = { x: 0, y: 0, inner: 0 };
let currentIndex = 0;
/** 페이지 일부 촬영 중이면 true */
let areaMode = false;

function setStyle(el: HTMLElement, prop: string, value: string): void {
  saved.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
  el.style.setProperty(prop, value, 'important');
}

const STYLE_ID = '__hanjang-capture-style';

/** 스크롤 막대만 숨긴다. overflow:hidden을 쓰면 body가 스크롤하는 페이지에서 스크롤 자체가 막힌다 */
function addScrollbarStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    'html, body { scrollbar-width: none !important; scroll-behavior: auto !important; }' +
    ' html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }';
  (document.head ?? document.documentElement).appendChild(style);
}

function removeScrollbarStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
}

function restoreStyles(): void {
  removeScrollbarStyle();
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i];
    if (s.value) s.el.style.setProperty(s.prop, s.value, s.priority);
    else s.el.style.removeProperty(s.prop);
  }
  saved = [];
}

function nextFrame(): Promise<void> {
  // 탭이 화면에 보이는 동안 촬영하므로 requestAnimationFrame이 돈다. 혹시 몰라 시간 제한을 둔다.
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 120);
  });
}

function documentHeight(): number {
  const d = document.documentElement;
  const b = document.body;
  return Math.max(d.scrollHeight, b ? b.scrollHeight : 0, d.clientHeight);
}

/** 문서가 스크롤되지 않으면 화면에서 가장 큰 내부 스크롤 영역을 찾는다 */
function findInnerScroller(viewportH: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = 0;
  // body 자신이 스크롤 상자인 페이지도 있으므로 body도 후보에 넣는다
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body, body *'))) {
    if (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight < viewportH * 0.3) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

function collectFixed(scope: ParentNode, includeFixed: boolean): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
    const pos = getComputedStyle(el).position;
    if (pos === 'sticky' || (includeFixed && pos === 'fixed')) out.push(el);
  }
  return out;
}

function collectLinks(): PageMetrics['links'] {
  const links: PageMetrics['links'] = [];
  const sx = window.scrollX;
  const sy = window.scrollY;
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (!/^(https?:|mailto:)/.test(a.href)) continue;
    for (const r of Array.from(a.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      links.push({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height, href: a.href });
      if (links.length >= 3000) return links;
    }
  }
  return links;
}

/** 창(window) 스크롤로 실제로 내려갈 수 있는지 1px 움직여 본다 */
function windowCanScroll(): boolean {
  const y = window.scrollY;
  const probe = y > 0 ? y - 1 : y + 1;
  window.scrollTo(window.scrollX, probe);
  const moved = window.scrollY !== y;
  window.scrollTo(window.scrollX, y);
  return moved;
}

function applyCaptureStyles(): void {
  // 스크롤 막대가 결과에 찍히지 않게 숨기고, 부드러운 스크롤을 끈다
  if (areaMode) setStyle(document.documentElement, 'scroll-behavior', 'auto');
  else addScrollbarStyle();
  if (target) setStyle(target, 'scroll-behavior', 'auto');
  // 고정·스티키 요소는 첫 조각에서만 보이게 한다 (CAP-06)
  if (currentIndex > 0) hideFixed();
}

function hideFixed(): void {
  for (const el of fixedEls) {
    if (el.style.getPropertyValue('visibility') !== 'hidden') setStyle(el, 'visibility', 'hidden');
  }
}

function currentScroll(): number {
  return target ? target.scrollTop : window.scrollY;
}

async function prepare(area = false): Promise<PageMetrics> {
  originalScroll = { x: window.scrollX, y: window.scrollY, inner: 0 };
  currentIndex = 0;
  restoreStyles();
  target = null;
  areaMode = area;
  // 촬영할 때와 같은 모양(스크롤 막대 없음)에서 크기와 링크 위치를 잰다
  if (!area) addScrollbarStyle();
  await nextFrame();

  const vh = window.innerHeight;
  const docH = documentHeight();
  if (area) target = document.querySelector<HTMLElement>(`[${SCROLLER_ATTR}]`);
  else if (docH <= vh + 1 || !windowCanScroll()) target = findInnerScroller(vh);
  applyCaptureStyles();
  await nextFrame();

  let regionTop = 0;
  let regionHeight = vh;
  let contentHeight = docH;
  if (target) {
    const r = target.getBoundingClientRect();
    regionTop = Math.max(0, Math.round(r.top + target.clientTop));
    regionHeight = Math.min(target.clientHeight, vh - regionTop);
    contentHeight = target.scrollHeight;
    originalScroll.inner = target.scrollTop;
    fixedEls = collectFixed(target, false);
  } else {
    contentHeight = documentHeight();
    fixedEls = collectFixed(document, true);
  }

  const links = target ? [] : collectLinks(); // TODO(추정): 내부 스크롤 영역의 링크는 PDF 링크로 넣지 않는다

  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    regionTop,
    regionHeight,
    contentHeight,
    scrollY: currentScroll(),
    documentScroll: !target,
    background: pickBackgroundColor([
      getComputedStyle(document.documentElement).backgroundColor,
      document.body ? getComputedStyle(document.body).backgroundColor : '',
    ]),
    title: document.title,
    url: location.href,
    links,
  };
}

async function scrollTo(y: number, index: number): Promise<number> {
  currentIndex = index;
  if (index > 0) hideFixed();
  if (target) target.scrollTop = y;
  else window.scrollTo(areaMode ? window.scrollX : 0, y);
  await nextFrame();
  return currentScroll();
}

/** 화면 안 이미지가 다 불러와질 때까지 기다린다 (SET-12, 지연 로딩 이미지) */
async function waitImages(timeoutMs: number): Promise<void> {
  const vh = window.innerHeight;
  const pending: Promise<void>[] = [];
  for (const img of Array.from(document.images)) {
    const r = img.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue;
    if (img.loading === 'lazy') img.loading = 'eager';
    if (img.complete) continue;
    pending.push(
      new Promise((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      }),
    );
  }
  if (pending.length === 0) return;
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
  await nextFrame();
}

function restore(): void {
  restoreStyles();
  document.querySelectorAll(`[${SCROLLER_ATTR}]`).forEach((el) => el.removeAttribute(SCROLLER_ATTR));
  if (target) target.scrollTop = originalScroll.inner;
  window.scrollTo(originalScroll.x, originalScroll.y);
  target = null;
  fixedEls = [];
}

async function handle(req: ContentRequest): Promise<unknown> {
  switch (req.kind) {
    case 'prepare':
      return prepare(req.area);
    case 'scrollTo':
      return scrollTo(req.y, req.index);
    case 'waitImages':
      return waitImages(req.timeoutMs);
    case 'suspend':
      // 잠시 멈춘 동안 사용자가 페이지를 쓸 수 있게 원래 모양으로 돌려 둔다
      restoreStyles();
      return null;
    case 'reapply':
      applyCaptureStyles();
      await nextFrame();
      return null;
    case 'restore':
      restore();
      return null;
  }
}

if (!window.__hanjangCapture) {
  window.__hanjangCapture = true;
  chrome.runtime.onMessage.addListener((req: ContentRequest, _sender, sendResponse) => {
    handle(req).then(
      (value) => sendResponse({ ok: true, value }),
      (err) => sendResponse({ ok: false, error: String(err) }),
    );
    return true;
  });
}
