// "페이지 일부" 영역 고르기 (PR #1 요청). 촬영할 탭에 그때그때 넣는다(activeTab).
// 화면을 어둡게 덮고, 마우스로 끈 사각형만 밝게 보여 준다. 손을 떼면 덮개를 지우고 서비스 워커에 영역을 알린다.
import { t } from '../shared/i18n';
import type { AreaSelected } from '../shared/messages';

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
              background: #16181d; color: #fff; font: 600 12px system-ui, sans-serif; white-space: nowrap; }
      .hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); padding: 9px 16px;
              border-radius: 999px; background: #16181d; color: #fff; font: 500 14px system-ui, sans-serif;
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

  let origin: { x: number; y: number } | null = null;
  let rect = { x: 0, y: 0, w: 0, h: 0 };

  const cleanup = () => {
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
    origin = { x: e.clientX, y: e.clientY };
    layer.classList.add('dragging');
    hint.style.display = 'none';
  });
  layer.addEventListener('pointermove', (e) => {
    if (!origin) return;
    const x = Math.min(origin.x, e.clientX);
    const y = Math.min(origin.y, e.clientY);
    rect = { x, y, w: Math.abs(e.clientX - origin.x), h: Math.abs(e.clientY - origin.y) };
    Object.assign(box.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    size.textContent = `${Math.round(rect.w * devicePixelRatio)} x ${Math.round(rect.h * devicePixelRatio)}`;
  });
  layer.addEventListener('pointerup', async () => {
    if (!origin) return;
    origin = null;
    cleanup();
    // 덮개가 찍히지 않도록 화면이 다시 그려질 때까지 기다린다
    await nextFrame();
    const msg: AreaSelected = { kind: 'areaSelected', rect, viewportWidth: window.innerWidth, title: document.title, url: location.href };
    const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean } | undefined;
    if (res && !res.ok) showFailed();
  });
}

function showFailed(): void {
  const el = document.createElement('div');
  el.textContent = t.area.failed;
  el.style.cssText =
    'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;padding:9px 16px;border-radius:999px;background:#d33a2c;color:#fff;font:500 14px system-ui,sans-serif';
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

start();
