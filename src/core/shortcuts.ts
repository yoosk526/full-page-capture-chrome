// 편집기 단축키 판별 (EDT-15, EXP-11)
// 글자 키는 e.code(자판 위치)로 본다. 한글 입력 상태에서도(e.key가 'ㄱ'일 때도) 동작하고,
// 맥에서 Option+Z처럼 e.key가 특수 문자로 바뀌어도 동작한다.

export type ToolId =
  | 'select'
  | 'crop'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'text'
  | 'highlighter'
  | 'blur'
  | 'badge'
  | 'pen'
  | 'brush';

export type EditorAction =
  | { type: 'tool'; tool: ToolId }
  | { type: 'undo' | 'redo' | 'duplicate' | 'copyObject' | 'paste' | 'delete' | 'enter' | 'escape' }
  | { type: 'export' | 'exportAs' | 'copyImage' | 'stampToggle' | 'zoomIn' | 'zoomOut' | 'help' }
  | { type: 'move'; dx: number; dy: number };

export interface KeyInput {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** 화살표 키로 옮기는 거리(px). TODO(미확인) */
export const MOVE_STEP = 1;
export const MOVE_STEP_FAST = 10;

const TOOL_KEYS: Record<string, ToolId> = {
  KeyV: 'select',
  KeyC: 'crop',
  KeyR: 'rect',
  KeyO: 'ellipse',
  KeyE: 'ellipse',
  KeyA: 'arrow',
  KeyL: 'line',
  KeyT: 'text',
  KeyH: 'highlighter',
  KeyB: 'blur',
  KeyN: 'badge',
  KeyP: 'pen',
  KeyM: 'brush',
};

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function resolveShortcut(e: KeyInput, isMac: boolean): EditorAction | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  // 맥에서 Ctrl, 윈도에서 Win 키가 눌리면 브라우저·운영체제 단축키로 남겨 둔다
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  if (otherMod) return null;

  if (mod) {
    switch (e.code) {
      case 'KeyZ':
        return e.altKey ? null : { type: e.shiftKey ? 'redo' : 'undo' };
      case 'KeyY':
        return e.shiftKey || e.altKey ? null : { type: 'redo' };
      case 'KeyD':
        return e.shiftKey || e.altKey ? null : { type: 'duplicate' };
      case 'KeyC':
        return e.shiftKey || e.altKey ? null : { type: 'copyObject' };
      case 'KeyV':
        return e.shiftKey || e.altKey ? null : { type: 'paste' };
      case 'KeyE':
        if (e.altKey) return e.shiftKey ? null : { type: 'copyImage' };
        return { type: e.shiftKey ? 'exportAs' : 'export' };
      default:
        return null;
    }
  }

  if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'delete' };
  if (e.key === 'Enter') return { type: 'enter' };
  if (e.key === 'Escape') return { type: 'escape' };
  if (ARROWS[e.key]) {
    const step = e.shiftKey ? MOVE_STEP_FAST : MOVE_STEP;
    const [dx, dy] = ARROWS[e.key];
    return { type: 'move', dx: dx * step, dy: dy * step };
  }
  if (e.shiftKey && (e.key === '?' || e.code === 'Slash')) return { type: 'help' };
  if (e.code === 'KeyZ') {
    if (e.shiftKey) return null;
    return { type: e.altKey ? 'zoomOut' : 'zoomIn' };
  }
  if (e.altKey || e.shiftKey) return null;
  if (e.code === 'KeyU') return { type: 'stampToggle' };
  const tool = TOOL_KEYS[e.code];
  return tool ? { type: 'tool', tool } : null;
}
