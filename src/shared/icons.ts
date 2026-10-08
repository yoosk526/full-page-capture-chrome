// 화면에 쓰는 아이콘 (직접 그린 단순한 SVG). 24x24 격자, 선 아이콘.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  eyeOff: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20 20 4"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  play: svg('<path d="M7 5l12 7-12 7z"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  plus: svg('<path d="M5 12h14M12 5v14"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  print: svg('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
  folder: svg('<path d="M3 6h6l2 2h10v11H3z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  flag: svg('<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  undo: svg('<path d="M9 7H4v5"/><path d="M4 12a8 8 0 1 1 3 6"/>'),
  redo: svg('<path d="M15 7h5v5"/><path d="M20 12a8 8 0 1 0-3 6"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  // 편집 도구
  select: svg('<path d="M5 3l14 8-6 2-3 6z"/>'),
  crop: svg('<path d="M6 2v16h16"/><path d="M2 6h16v16"/>'),
  rect: svg('<rect x="4" y="5" width="16" height="14" rx="1"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="9" ry="7"/>'),
  arrow: svg('<path d="M5 19 19 5M10 5h9v9"/>'),
  line: svg('<path d="M5 19 19 5"/>'),
  text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  highlighter: svg('<path d="M4 20h7"/><path d="M8 16l-2-2 9-9 4 4-9 9z"/><path d="M6 14l-2 4 4-2"/>'),
  blur: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
  badge: svg('<circle cx="12" cy="12" r="9"/><path d="M11 9l2-1v8"/>'),
  pen: svg('<path d="M3 21l3-1 12-12-2-2L4 18z"/><path d="M14 6l2-2 4 4-2 2"/>'),
  brush: svg('<path d="M14 4l6 6-7 7-6-6z"/><path d="M7 11c-3 0-4 3-4 6v3h3c3 0 6-1 6-4"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
};

export type IconName = keyof typeof icons;
