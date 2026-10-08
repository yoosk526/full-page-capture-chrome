// 실행 취소 / 다시 실행 이력 (EDT-11). 문서 전체 상태를 통째로 쌓는다(문서는 불변 객체로 다룬다).

/** 되돌릴 수 있는 최대 단계 수. TODO(미확인): 기존 프로그램의 한도는 모름 */
export const HISTORY_LIMIT = 100;

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private current: T,
    private readonly limit: number = HISTORY_LIMIT,
  ) {}

  get present(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 새 작업. 다시 실행 목록은 비워진다. 한도를 넘으면 가장 오래된 단계를 버린다 */
  push(next: T): void {
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
  }

  /** 마지막 단계를 새 상태로 바꾼다 (화살표 키로 연달아 옮길 때 한 단계로 묶는 용도) */
  replace(next: T): void {
    this.current = next;
    this.future = [];
  }

  /** 되돌릴 것이 없으면 null을 돌려주고 상태는 그대로 둔다 */
  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next;
  }
}
