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

/** 메뉴 열기/닫기: 버튼을 누르면 열리고 바깥을 누르거나 Esc를 누르면 닫힌다 */
export function bindMenu(button: HTMLElement, menu: HTMLElement): void {
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    document.querySelectorAll<HTMLElement>('.menu').forEach((m) => (m.hidden = true));
    if (open) {
      const r = button.getBoundingClientRect();
      menu.hidden = false;
      const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${r.bottom + 4}px`;
    }
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => (menu.hidden = true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.hidden = true;
  });
}

export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
