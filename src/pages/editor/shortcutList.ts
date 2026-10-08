// 단축키 창에 보여 줄 목록 (EDT-15). 4묶음, 2단 배치
import { t } from '../../shared/i18n';

type Keys = string[][]; // 바깥 배열 = "또는", 안쪽 배열 = 함께 누르는 키

export interface ShortcutGroup {
  title: string;
  items: { label: string; keys: Keys | string }[];
}

export function shortcutGroups(isMac: boolean): ShortcutGroup[] {
  const mod = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';
  const shift = isMac ? '⇧' : 'Shift';
  const i = t.shortcuts.items;
  return [
    {
      title: t.shortcuts.groups.shapes,
      items: [
        { label: i.rect, keys: [['R']] },
        { label: i.ellipse, keys: [['O'], ['E']] },
        { label: i.line, keys: [['L']] },
        { label: i.arrow, keys: [['A']] },
        { label: i.text, keys: [['T']] },
        { label: i.highlighter, keys: [['H']] },
        { label: i.blur, keys: [['B']] },
        { label: i.badge, keys: [['N']] },
      ],
    },
    {
      title: t.shortcuts.groups.tools,
      items: [
        { label: i.select, keys: [['V']] },
        { label: i.crop, keys: [['C']] },
        { label: i.pen, keys: [['P']] },
        { label: i.brush, keys: [['M']] },
        { label: i.cropApply, keys: [['Enter']] },
        { label: i.cropCancel, keys: [['Esc']] },
      ],
    },
    {
      title: t.shortcuts.groups.layers,
      items: [
        { label: i.move, keys: t.shortcuts.mouseOrArrows },
        { label: i.moveFast, keys: [[shift, '←↑→↓']] },
        { label: i.duplicate, keys: [[mod, 'D']] },
        { label: i.copy, keys: [[mod, 'C']] },
        { label: i.paste, keys: [[mod, 'V']] },
        { label: i.delete, keys: [['Delete']] },
      ],
    },
    {
      title: t.shortcuts.groups.document,
      items: [
        { label: i.stampToggle, keys: [['U']] },
        { label: i.zoomIn, keys: [['Z']] },
        { label: i.zoomOut, keys: [[alt, 'Z']] },
        { label: i.undo, keys: [[mod, 'Z']] },
        { label: i.redo, keys: [[mod, 'Y'], [mod, shift, 'Z']] },
        { label: i.export, keys: [[mod, 'E']] },
        { label: i.exportAs, keys: [[mod, shift, 'E']] },
        { label: i.copyImage, keys: [[mod, alt, 'E']] },
        { label: i.help, keys: [[shift, '?']] },
      ],
    },
  ];
}
