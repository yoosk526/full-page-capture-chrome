// 여러 화면에서 같이 쓰는 작은 도우미
import { icons, type IconName } from './icons';

/** 저장소의 이슈 페이지 (10번 방침 5: 문제 신고는 이 링크로 대체) */
export const REPORT_URL = 'https://github.com/yoosk526/full-page-capture-chrome/issues';

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

/** data-icon="name" 속성이 있는 요소 앞에 아이콘을 넣는다 */
export function applyIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    if (el.querySelector('svg')) return;
    el.insertAdjacentHTML('afterbegin', icons[el.dataset.icon as IconName] ?? '');
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove('show'), 2400);
}

export function openPage(path: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

export function openReport(): void {
  void chrome.tabs.create({ url: REPORT_URL });
}

/**
 * 메뉴 열기/닫기: 버튼을 누르면 열리고 바깥을 누르거나 Esc를 누르면 닫힌다.
 * hover를 켜면 마우스를 올리기만 해도 열리고, 버튼과 메뉴 밖으로 나가면 닫힌다 (PR #1 요청)
 * anchor를 주면 그 요소의 오른쪽 끝에 맞춰 연다
 */
export function bindMenu(button: HTMLElement, menu: HTMLElement, opts: { hover?: boolean; anchor?: HTMLElement } = {}): void {
  const place = () => {
    document.querySelectorAll<HTMLElement>('.menu').forEach((m) => {
      if (m !== menu) m.hidden = true;
    });
    const r = (opts.anchor ?? button).getBoundingClientRect();
    menu.hidden = false;
    const left = opts.anchor ? r.right - menu.offsetWidth : Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${r.bottom + 6}px`;
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden || opts.hover) place();
    else menu.hidden = true;
  });
  if (opts.hover) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keep = () => clearTimeout(timer);
    const leave = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (menu.hidden = true), 250);
    };
    button.addEventListener('mouseenter', () => {
      keep();
      place();
    });
    button.addEventListener('mouseleave', leave);
    menu.addEventListener('mouseenter', keep);
    menu.addEventListener('mouseleave', leave);
  }
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => (menu.hidden = true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.hidden = true;
  });
}

export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
