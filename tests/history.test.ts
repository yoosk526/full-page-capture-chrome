import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, History } from '../src/core/history';

/** n번 작업한 뒤 되돌릴 수 있는 횟수를 센다 */
function undoCountAfter(n: number): number {
  const h = new History(0);
  for (let i = 1; i <= n; i++) h.push(i);
  let count = 0;
  while (h.undo() !== null) count++;
  return count;
}

describe('History: 실행 취소 / 다시 실행 (EDT-11)', () => {
  // 목적: 이력이 비었을 때 실행 취소를 누르면 상태가 사라지거나 오류가 나는 결함을 막는다
  it('[EP] TC-HIS-01 비어 있음에서 실행 취소 → null, 현재 상태 그대로, 버튼 비활성', () => {
    const h = new History('처음');
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.present).toBe('처음');
  });

  // 목적: 한도보다 적게 작업했을 때 일부 단계를 잃는 결함을 막는다
  it('[BVA] TC-HIS-02 작업 수 = 한도-1 → 모두 되돌릴 수 있음', () => {
    expect(undoCountAfter(HISTORY_LIMIT - 1)).toBe(HISTORY_LIMIT - 1);
  });

  // 목적: 정확히 한도만큼 작업했을 때 한 단계를 미리 버리는 off-by-one 결함을 막는다
  it('[BVA] TC-HIS-03 작업 수 = 한도 → 한도만큼 되돌릴 수 있음', () => {
    expect(undoCountAfter(HISTORY_LIMIT)).toBe(HISTORY_LIMIT);
  });

  // 목적: 한도를 넘었을 때 이력이 끝없이 쌓여 메모리를 다 쓰는 결함을 막는다
  it('[BVA] TC-HIS-04 작업 수 = 한도+1 → 한도만큼만 되돌림(가장 오래된 단계 버림)', () => {
    const h = new History(0);
    for (let i = 1; i <= HISTORY_LIMIT + 1; i++) h.push(i);
    while (h.undo() !== null);
    expect(h.present).toBe(1);
  });

  // 목적: 되돌린 뒤 새 작업을 했는데 예전 "다시 실행"이 남아 엉뚱한 상태로 돌아가는 결함을 막는다
  it('[EP] TC-HIS-05 실행 취소 후 새 작업 → 다시 실행 목록 비움', () => {
    const h = new History('a');
    h.push('b');
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push('c');
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.present).toBe('c');
  });

  // 목적: 실행 취소 → 다시 실행이 원래 상태로 돌아오지 않는 결함을 막는다
  it('[EP] TC-HIS-06 실행 취소 → 다시 실행 → 원래 상태', () => {
    const h = new History('a');
    h.push('b');
    h.undo();
    expect(h.redo()).toBe('b');
    expect(h.present).toBe('b');
  });
});
