// 지금은 한국어만 있다 (SET-03). 언어를 추가하면 여기서 navigator.language로 고른다.
import { ko, type Messages } from './ko';

export const t: Messages = ko;

/** HTML 안의 data-i18n="a.b.c" 속성을 문구로 채운다 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const v = lookup(el.dataset.i18n!);
    if (typeof v === 'string') el.textContent = v;
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const v = lookup(el.dataset.i18nTitle!);
    if (typeof v === 'string') {
      el.title = v;
      el.setAttribute('aria-label', v);
    }
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    const v = lookup(el.dataset.i18nPlaceholder!);
    if (typeof v === 'string') el.placeholder = v;
  });
}

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), t);
}
