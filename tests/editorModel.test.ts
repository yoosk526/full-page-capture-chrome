import { describe, expect, it } from 'vitest';
import { emptyDoc, type EditorDoc, type EditorObject } from '../src/core/doc';
import {
  LIMITS,
  addBadge,
  addObject,
  clampValue,
  cloneInto,
  cloneManyInto,
  moveObjects,
  removeObjects,
  resetDoc,
  hasEdits,
  hitTest,
  moveLayer,
  resizeObject,
  resizeRect,
  translateObject,
} from '../src/core/editorModel';

const base = (): EditorDoc => emptyDoc({ position: 'none', dateFormat: 'date' });
const box = { x: 0, y: 0, w: 40, h: 40 };
const rect = (id: string, x = 0): EditorObject => ({ id, type: 'rect', x, y: 0, w: 100, h: 100, color: '#000', width: 4, fill: null, radius: 0 });
const numbers = (d: EditorDoc) => d.objects.map((o) => (o.type === 'badge' ? o.number : null));

describe('번호 표시 번호 매기기 (EDT-06)', () => {
  // 목적: 첫 번호 표시가 0이나 2로 시작하는 결함을 막는다
  it('[EP] TC-BADGE-01 빈 문서에서 첫 번호 표시 → 1', () => {
    expect(numbers(addBadge(base(), box, '#000', 'b1'))).toEqual([1]);
  });

  // 목적: 연속으로 만든 번호가 같은 숫자로 겹치는 결함을 막는다
  it('[EP] TC-BADGE-02 연속으로 3개 만들기 → 1, 2, 3', () => {
    let d = base();
    for (const id of ['b1', 'b2', 'b3']) d = addBadge(d, box, '#000', id);
    expect(numbers(d)).toEqual([1, 2, 3]);
  });

  // 목적: 번호 표시를 복제하면 같은 번호가 두 개 생기는 결함을 막는다
  it('[EP] TC-BADGE-03 번호 표시 복제 → 새 번호(다음 숫자)', () => {
    const d = addBadge(base(), box, '#000', 'b1');
    const copied = cloneInto(d, d.objects[0], 20, 'b2');
    expect(numbers(copied)).toEqual([1, 2]);
  });
});

describe('개체 겹침 순서 (EDT-10 앞으로 가져오기)', () => {
  // 목적: "앞으로 가져오기"가 한 칸이 아니라 맨 앞으로 보내거나 순서를 망가뜨리는 결함을 막는다
  it('[EP] TC-LAYER-01 가운데 개체 앞으로 → 한 칸 위', () => {
    const d = ['a', 'b', 'c'].reduce((doc, id) => addObject(doc, rect(id)), base());
    expect(moveLayer(d, 'b', 1).objects.map((o) => o.id)).toEqual(['a', 'c', 'b']);
  });

  // 목적: 맨 위 개체를 더 앞으로 보내면 개체가 사라지는 결함을 막는다
  it('[BVA] TC-LAYER-02 맨 위 개체 앞으로 → 그대로', () => {
    const d = ['a', 'b'].reduce((doc, id) => addObject(doc, rect(id)), base());
    expect(moveLayer(d, 'b', 1)).toBe(d);
  });

  // 목적: 맨 아래 개체를 더 뒤로 보내면 개체가 사라지는 결함을 막는다
  it('[BVA] TC-LAYER-03 맨 아래 개체 뒤로 → 그대로', () => {
    const d = ['a', 'b'].reduce((doc, id) => addObject(doc, rect(id)), base());
    expect(moveLayer(d, 'a', -1)).toBe(d);
  });
});

describe('clampValue: 두께·글자 크기 범위 (상수 기준, 범위는 [미확인])', () => {
  const s = LIMITS.stroke;
  // 목적: 최소보다 작은 두께(0)가 들어가 선이 안 보이는 결함을 막는다
  it('[BVA] TC-LIM-01 두께 = 최소-1 → 최소', () => {
    expect(clampValue('stroke', s.min - 1)).toBe(s.min);
  });

  // 목적: 최소값 자체를 바꾸는 결함을 막는다
  it('[BVA] TC-LIM-02 두께 = 최소 → 그대로', () => {
    expect(clampValue('stroke', s.min)).toBe(s.min);
  });

  // 목적: 최대값 자체를 바꾸는 결함을 막는다
  it('[BVA] TC-LIM-03 두께 = 최대 → 그대로', () => {
    expect(clampValue('stroke', s.max)).toBe(s.max);
  });

  // 목적: 최대를 넘는 두께가 들어가는 결함을 막는다
  it('[BVA] TC-LIM-04 두께 = 최대+1 → 최대', () => {
    expect(clampValue('stroke', s.max + 1)).toBe(s.max);
  });

  // 목적: 범위가 다른 항목(글자 크기)에 두께 범위를 잘못 쓰는 결함을 막는다
  it('[BVA] TC-LIM-05 글자 크기 = 최대+1 → 글자 크기 최대', () => {
    expect(clampValue('fontSize', LIMITS.fontSize.max + 1)).toBe(LIMITS.fontSize.max);
  });

  // 목적: 숫자가 아닌 값(NaN)이 들어가 그리기가 깨지는 결함을 막는다
  it('[EP] TC-LIM-06 숫자가 아님(NaN) → 최소', () => {
    expect(clampValue('stroke', Number.NaN)).toBe(s.min);
  });
});

describe('hitTest: 누른 위치의 개체 찾기 (EDT-01)', () => {
  const line: EditorObject = { id: 'L', type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, color: '#000', width: 4 };
  // 목적: 겹친 개체 중 아래 개체가 골라지는 결함을 막는다
  it('[EP] TC-HIT-01 두 개체가 겹친 곳 → 위(나중) 개체', () => {
    expect(hitTest([rect('a'), rect('b', 50)], 60, 50, 0)).toBe('b');
  });

  // 목적: 선의 굵기 안을 눌렀는데 못 고르는 결함을 막는다
  it('[EP] TC-HIT-02 선 위(굵기 안) → 그 선', () => {
    expect(hitTest([line], 50, 2, 0)).toBe('L');
  });

  // 목적: 자유 곡선(펜)의 선 위를 눌러도 고르지 못하는 결함을 막는다(점 사이 구간 판정)
  it('[EP] TC-HIT-04 펜 곡선의 두 점 사이 → 그 펜', () => {
    const pen: EditorObject = { id: 'P', type: 'pen', points: [0, 0, 100, 100, 200, 0], color: '#000', width: 4 };
    expect(hitTest([pen], 150, 50, 0)).toBe('P');
  });

  // 목적: 빈 곳을 눌렀는데 엉뚱한 개체가 골라지는 결함을 막는다
  it('[EP] TC-HIT-03 개체에서 먼 곳 → 없음', () => {
    expect(hitTest([line, rect('a', 500)], 50, 60, 6)).toBeNull();
  });
});

describe('resizeRect: 핸들로 크기 조절 (EDT-01)', () => {
  // 목적: 오른쪽 아래 핸들을 끌었을 때 크기가 늘지 않는 결함을 막는다
  it('[EP] TC-RSZ-01 오른쪽 아래 핸들을 (+10, +20) → 폭·높이 증가', () => {
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'se', 10, 20)).toEqual({ x: 0, y: 0, w: 110, h: 70 });
  });

  // 목적: 핸들을 반대편 너머로 끌었을 때 폭이 음수가 되어 그리기·저장이 깨지는 결함을 막는다
  it('[EP] TC-RSZ-02 왼쪽 핸들을 오른쪽 변 너머로 → 뒤집혀 양수 폭', () => {
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'w', 130, 0)).toEqual({ x: 100, y: 0, w: 30, h: 50 });
  });
});

describe('자유 곡선과 번호 표시의 이동·크기 조절 (EDT-01, EDT-16)', () => {
  const pen: EditorObject = { id: 'P', type: 'pen', points: [10, 20, 30, 40], color: '#000', width: 4 };
  // 목적: 점 목록에서 x와 y를 뒤바꿔 옮겨 곡선이 엉뚱한 곳으로 가는 결함을 막는다
  it('[EP] TC-MOVE-01 펜 곡선을 (+5, -10) 이동 → 모든 x에 +5, 모든 y에 -10', () => {
    expect(translateObject(pen, 5, -10)).toMatchObject({ points: [15, 10, 35, 30] });
  });

  // 목적: 곡선 크기를 조절할 때 모양 비율이 깨지거나 기준점이 어긋나는 결함을 막는다
  it('[EP] TC-RSZ-03 펜 곡선(20x20)의 오른쪽 아래 핸들을 (+20, +20) → 점들이 2배로 늘어남', () => {
    expect(resizeObject(pen, 'se', 20, 20)).toMatchObject({ points: [10, 20, 50, 60] });
  });

  // 목적: 번호 표시를 한쪽으로만 늘려 원이 찌그러지는(정사각형이 깨지는) 결함을 막는다
  it('[EP] TC-RSZ-04 번호 표시를 가로로만 (+30, 0) 끌기 → 가로·세로가 같은 크기', () => {
    const badge: EditorObject = { id: 'B', type: 'badge', x: 0, y: 0, w: 40, h: 40, color: '#000', number: 1 };
    const r = resizeObject(badge, 'se', 30, 0) as { w: number; h: number };
    expect(r.w).toBe(r.h);
    expect(r.w).toBe(70);
  });
});

describe('여러 개 선택한 개체 다루기 (PR #1 요청: Shift 다중 선택)', () => {
  const three = () => ['a', 'b', 'c'].reduce((doc, id, i) => addObject(doc, rect(id, i * 200)), base());
  // 목적: 여러 개를 지울 때 선택하지 않은 개체까지 지워지거나 일부만 지워지는 결함을 막는다
  it('[EP] TC-MULTI-01 a, c 선택 후 지우기 → b만 남음', () => {
    expect(removeObjects(three(), ['a', 'c']).objects.map((o) => o.id)).toEqual(['b']);
  });

  // 목적: 여러 개를 옮길 때 선택하지 않은 개체도 함께 움직이는 결함을 막는다
  it('[EP] TC-MULTI-02 a, b 선택 후 (+5, +7) 옮기기 → a, b만 이동', () => {
    const moved = moveObjects(three(), ['a', 'b'], 5, 7).objects.map((o) => (o.type === 'rect' ? [o.x, o.y] : null));
    expect(moved).toEqual([[5, 7], [205, 7], [400, 0]]);
  });

  // 목적: 여러 개를 복제할 때 겹침 순서가 뒤바뀌거나 번호 표시 번호가 겹치는 결함을 막는다
  it('[EP] TC-MULTI-03 번호 표시 2개 복제 → 원래 순서대로 맨 위에, 새 번호 3, 4', () => {
    let d = addBadge(base(), box, '#000', 'b1');
    d = addBadge(d, box, '#000', 'b2');
    const r = cloneManyInto(d, [d.objects[1], d.objects[0]]);
    expect(numbers(r.doc)).toEqual([1, 2, 3, 4]);
    expect(r.ids).toHaveLength(2);
  });
});

describe('resetDoc: 편집한 내용 모두 초기화 (PR #1 두 번째 요청)', () => {
  // 목적: 초기화 뒤에도 자르기·번호·주소 띠 중 일부가 남는 결함, 날짜 형식 선택까지 지워지는 결함을 막는다
  it('[EP] TC-RESET-01 개체·자르기·주소 띠가 있는 문서 → 편집 없음, 다음 번호 1부터, 날짜 형식 유지', () => {
    let d: EditorDoc = { ...addBadge(base(), box, '#000', 'b1'), crop: { x: 0, y: 0, w: 50, h: 50 }, stamp: { position: 'top', dateFormat: 'iso' } };
    d = addObject(d, rect('r1'));
    const r = resetDoc(d);
    expect(hasEdits(r)).toBe(false);
    expect(r.badgeCounter).toBe(0);
    expect(r.stamp.dateFormat).toBe('iso');
  });
});
