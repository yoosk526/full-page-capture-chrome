import { describe, expect, it } from 'vitest';
import { MOVE_STEP, MOVE_STEP_FAST, resolveShortcut, type KeyInput } from '../src/core/shortcuts';

const key = (k: Partial<KeyInput>): KeyInput => ({ key: '', code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...k });

describe('resolveShortcut: 편집기 단축키 (EDT-15, EXP-11)', () => {
  // 목적: 한글 입력 상태(e.key='ㄱ')에서 도구 단축키가 안 먹는 결함을 막는다
  it('[EP] TC-KEY-01 한글 입력 상태에서 R 자리 키(ㄱ) → 사각형 도구', () => {
    expect(resolveShortcut(key({ key: 'ㄱ', code: 'KeyR' }), false)).toEqual({ type: 'tool', tool: 'rect' });
  });

  // 목적: 맥에서 Option+Z(e.key가 Ω로 바뀜)가 축소로 인식되지 않는 결함을 막는다
  it('[EP] TC-KEY-02 맥 Option+Z(e.key=Ω) → 축소', () => {
    expect(resolveShortcut(key({ key: 'Ω', code: 'KeyZ', altKey: true }), true)).toEqual({ type: 'zoomOut' });
  });

  // 목적: Z 단독(확대)과 Cmd+Z(실행 취소)가 뒤섞이는 결함을 막는다
  it('[EP] TC-KEY-03 맥 Cmd+Z → 실행 취소, Z 단독 → 확대', () => {
    expect(resolveShortcut(key({ key: 'z', code: 'KeyZ', metaKey: true }), true)).toEqual({ type: 'undo' });
    expect(resolveShortcut(key({ key: 'z', code: 'KeyZ' }), true)).toEqual({ type: 'zoomIn' });
  });

  // 목적: 다시 실행의 두 번째 조합(Cmd+Shift+Z)이 실행 취소로 처리되는 결함을 막는다
  it('[EP] TC-KEY-04 맥 Cmd+Shift+Z → 다시 실행', () => {
    expect(resolveShortcut(key({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }), true)).toEqual({ type: 'redo' });
  });

  // 목적: 윈도에서 Cmd 대신 Ctrl을 써야 하는데 Ctrl+Y가 동작하지 않는 결함을 막는다
  it('[EP] TC-KEY-05 윈도 Ctrl+Y → 다시 실행', () => {
    expect(resolveShortcut(key({ key: 'y', code: 'KeyY', ctrlKey: true }), false)).toEqual({ type: 'redo' });
  });

  // 목적: 내보내기 3종(Cmd+E / Cmd+Shift+E / Cmd+Alt+E)이 서로 뒤바뀌는 결함을 막는다
  it('[EP] TC-KEY-06 Ctrl+E / Ctrl+Shift+E / Ctrl+Alt+E → 저장 / 위치 골라 저장 / 클립보드 복사', () => {
    expect(resolveShortcut(key({ code: 'KeyE', ctrlKey: true }), false)).toEqual({ type: 'export' });
    expect(resolveShortcut(key({ code: 'KeyE', ctrlKey: true, shiftKey: true }), false)).toEqual({ type: 'exportAs' });
    expect(resolveShortcut(key({ code: 'KeyE', ctrlKey: true, altKey: true }), false)).toEqual({ type: 'copyImage' });
  });

  // 목적: 브라우저 단축키(Ctrl+R 새로고침)를 가로채 사각형 도구로 바꾸는 결함을 막는다
  it('[EP] TC-KEY-07 윈도 Ctrl+R → 처리하지 않음(null)', () => {
    expect(resolveShortcut(key({ key: 'r', code: 'KeyR', ctrlKey: true }), false)).toBeNull();
  });

  // 목적: Shift+?(도움말)가 인식되지 않는 결함을 막는다
  it('[EP] TC-KEY-08 Shift+? → 단축키 창', () => {
    expect(resolveShortcut(key({ key: '?', code: 'Slash', shiftKey: true }), false)).toEqual({ type: 'help' });
  });

  // 목적: Shift+화살표(빠르게 이동)가 일반 이동과 같은 거리로 움직이는 결함을 막는다
  it('[EP] TC-KEY-09 화살표 → 1칸, Shift+화살표 → 크게 이동', () => {
    expect(resolveShortcut(key({ key: 'ArrowLeft' }), false)).toEqual({ type: 'move', dx: -MOVE_STEP, dy: 0 });
    expect(resolveShortcut(key({ key: 'ArrowDown', shiftKey: true }), false)).toEqual({ type: 'move', dx: 0, dy: MOVE_STEP_FAST });
  });

  // 목적: 없앤 붓 도구(M)가 단축키로 다시 켜지는 결함을 막는다 (PR #1 요청)
  it('[EP] TC-KEY-10 M 키 → 처리하지 않음(null)', () => {
    expect(resolveShortcut(key({ key: 'm', code: 'KeyM' }), false)).toBeNull();
  });
});
