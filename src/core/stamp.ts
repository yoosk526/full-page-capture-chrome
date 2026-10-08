// 주소와 날짜 도장 (EXP-06): 날짜 문구 만들기와 결과 이미지 배치 계산
import type { EditorDoc, Rect, StampDateFormat, StampPosition } from './doc';

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** UTC와의 차이(분). 서울은 +540 */
  offsetMin: number;
}

/** 시간대(timeZone)를 적용한 날짜·시각 숫자들. timeZone을 비우면 이 기기의 시간대 */
export function dateParts(date: Date, timeZone?: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second, offsetMin };
}

const pad = (n: number) => String(n).padStart(2, '0');

function gmtLabel(offsetMin: number): string {
  if (offsetMin === 0) return 'GMT';
  const sign = offsetMin > 0 ? '+' : '-';
  const a = Math.abs(offsetMin);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `GMT${sign}${h}${m ? `:${pad(m)}` : ''}`;
}

/**
 * 도장에 넣을 날짜 문구 (한국어 화면 기준, FEATURES.md EXP-06의 관찰 표기)
 * - date: 2026년 10월 9일
 * - datetime: 2026년 10월 9일 오전 12:02 GMT+9
 * - iso: 2026-10-09T00:02:26+09:00
 * - none: 빈 문자열
 */
export function formatStampDate(date: Date, format: StampDateFormat, timeZone?: string): string {
  if (format === 'none') return '';
  const p = dateParts(date, timeZone);
  const day = `${p.year}년 ${p.month}월 ${p.day}일`;
  if (format === 'date') return day;
  if (format === 'datetime') {
    const ampm = p.hour < 12 ? '오전' : '오후';
    const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
    return `${day} ${ampm} ${h12}:${pad(p.minute)} ${gmtLabel(p.offsetMin)}`;
  }
  const sign = p.offsetMin >= 0 ? '+' : '-';
  const a = Math.abs(p.offsetMin);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export interface StampContent {
  position: Exclude<StampPosition, 'none'>;
  /** 이미지 위에 붙는지 아래에 붙는지 */
  placement: 'top' | 'bottom';
  /** 띠(band) 또는 브라우저 창 모양(mac, windows) */
  frame: 'band' | 'mac' | 'windows';
  /** 왼쪽(또는 주소창 안)에 들어갈 주소 */
  url: string;
  /** 오른쪽 끝에 들어갈 날짜. 날짜 형식이 "날짜 빼기"면 빈 문자열 */
  date: string;
}

/**
 * 위치와 날짜 형식으로 도장 내용을 정한다. 위치가 "표시 안 함"이면 null.
 * TODO(미확인): 날짜가 촬영 시각인지 지금 시각인지 모른다. 촬영 시각(capturedAt)을 쓴다.
 */
export function buildStamp(
  position: StampPosition,
  dateFormat: StampDateFormat,
  url: string,
  capturedAt: Date,
  timeZone?: string,
): StampContent | null {
  if (position === 'none') return null;
  return {
    position,
    placement: position === 'bottom' ? 'bottom' : 'top',
    frame: position === 'mac' || position === 'windows' ? position : 'band',
    url,
    date: formatStampDate(capturedAt, dateFormat, timeZone),
  };
}

/** 도장 높이(px). 이미지 폭에 비례하되 너무 작거나 크지 않게 */
export function stampHeight(position: StampPosition, width: number): number {
  if (position === 'none') return 0;
  const band = Math.min(72, Math.max(28, Math.round(width * 0.028)));
  return position === 'mac' || position === 'windows' ? Math.round(band * 1.5) : band;
}

export interface OutputLayout {
  /** 원본 이미지에서 쓰는 영역 */
  crop: Rect;
  width: number;
  height: number;
  /** 결과 이미지에서 원본 영역이 시작하는 세로 위치 */
  imageY: number;
  stamp: { y: number; h: number } | null;
}

/** 자르기와 도장을 반영한 결과 이미지의 크기와 배치 */
export function outputLayout(doc: Pick<EditorDoc, 'crop' | 'stamp'>, imageW: number, imageH: number): OutputLayout {
  const crop = doc.crop ?? { x: 0, y: 0, w: imageW, h: imageH };
  const h = stampHeight(doc.stamp.position, crop.w);
  if (h === 0) return { crop, width: crop.w, height: crop.h, imageY: 0, stamp: null };
  const top = doc.stamp.position !== 'bottom';
  return {
    crop,
    width: crop.w,
    height: crop.h + h,
    imageY: top ? h : 0,
    stamp: { y: top ? 0 : crop.h, h },
  };
}
