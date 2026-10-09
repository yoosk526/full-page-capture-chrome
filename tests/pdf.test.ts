import { describe, expect, it } from 'vitest';
import {
  PAGE_MIN_PX,
  SMART_BREAK_WINDOW,
  blankRows,
  buildPdf,
  dominantColor,
  moveBreak,
  removeBreak,
  findRowGap,
  linksForSlice,
  mapLinks,
  pageGeometry,
  pageSlices,
  pdfUri,
} from '../src/core/pdf';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('pageSlices: PDF 페이지 나누기 (EXP-03)', () => {
  // 목적: 한 페이지에 딱 맞는 이미지에 빈 두 번째 페이지가 생기는 결함을 막는다
  it('[BVA] TC-PDF-01 이미지 높이 = 페이지 높이 → 1페이지', () => {
    expect(pageSlices(1000, 1000)).toEqual([{ y: 0, h: 1000 }]);
  });

  // 목적: 페이지 높이를 1px 넘을 때 마지막 1px을 잃는 결함을 막는다
  it('[BVA] TC-PDF-02 이미지 높이 = 페이지 높이+1 → 2페이지, 두 번째 높이 1', () => {
    expect(pageSlices(1001, 1000)).toEqual([
      { y: 0, h: 1000 },
      { y: 1000, h: 1 },
    ]);
  });

  // 목적: 똑똑한 페이지 나누기가 범위를 벗어난 위치(너무 위)로 옮겨 페이지가 거의 비는 결함을 막는다
  it('[EP] TC-PDF-03 줄 사이 위치가 탐색 범위 밖(100) → 무시하고 원래 위치(1000)에서 나눔', () => {
    const slices = pageSlices(2500, 1000, () => 100);
    expect(slices[0]).toEqual({ y: 0, h: 1000 });
  });

  // 목적: 똑똑한 페이지 나누기 결과가 다음 페이지 시작에 반영되지 않아 내용이 겹치거나 빠지는 결함을 막는다
  it('[EP] TC-PDF-04 줄 사이가 950 → 첫 페이지 높이 950, 다음 페이지는 950에서 시작', () => {
    const slices = pageSlices(2500, 1000, (ideal) => ideal - 50);
    expect(slices.slice(0, 2)).toEqual([
      { y: 0, h: 950 },
      { y: 950, h: 950 },
    ]);
    expect(slices.reduce((s, x) => s + x.h, 0)).toBe(2500);
  });
});

describe('findRowGap / blankRows: 줄과 줄 사이 찾기 (SET-21)', () => {
  // 목적: 범위 안에 빈 줄이 있는데 못 찾아 글자 한가운데서 자르는 결함을 막는다
  it('[EP] TC-GAP-01 범위 안에 빈 줄(y=905) → 그 줄 바로 아래(906)에서 나눔', () => {
    expect(findRowGap(1000, 800, (y) => y === 905)).toBe(906);
  });

  // 목적: 빈 줄이 없을 때 엉뚱한 위치를 돌려주는 결함을 막는다
  it('[EP] TC-GAP-02 빈 줄 없음 → 원래 위치', () => {
    expect(findRowGap(1000, 800, () => false)).toBe(1000);
  });

  // 목적: 범위 맨 아래 경계의 빈 줄을 놓치는 결함을 막는다
  it('[BVA] TC-GAP-03 빈 줄이 최소 위치(800)에만 있음 → 801', () => {
    expect(findRowGap(1000, 800, (y) => y === 800)).toBe(801);
  });

  // 목적: 범위 바로 밖(최소-1)의 빈 줄을 써서 페이지가 너무 짧아지는 결함을 막는다
  it('[BVA] TC-GAP-04 빈 줄이 최소-1(799)에만 있음 → 원래 위치', () => {
    expect(findRowGap(1000, 800, (y) => y === 799)).toBe(1000);
  });

  // 목적: 글자가 있는 줄을 빈 줄로 판정하는 결함을 막는다
  it('[EP] TC-GAP-05 한 가지 색 줄 → 빈 줄, 다른 색 점이 있는 줄 → 빈 줄 아님', () => {
    const w = 3;
    const data = new Uint8ClampedArray([
      // 0번 줄: 흰색 3개
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      // 1번 줄: 가운데 검은 점
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    expect(blankRows(data, w, 2)).toEqual([true, false]);
  });

  // 목적: 탐색 범위가 페이지 전체가 되어 페이지가 매우 짧게 나뉘는 결함을 막는다
  it('[BVA] TC-GAP-06 탐색 범위 맨 위(최소 위치)에서 줄 사이를 찾음 → 첫 페이지 높이 = 페이지 높이 x (1 - 탐색 비율)', () => {
    const slices = pageSlices(3000, 1000, (_ideal, min) => min);
    expect(slices[0].h).toBe(Math.ceil(1000 - 1000 * SMART_BREAK_WINDOW));
  });
});

describe('pageGeometry: 용지 4가지 (SET-20)', () => {
  // 목적: "이미지 한 장" 용지가 고정 크기 용지로 잘리는 결함을 막는다
  it('[EP] TC-PAPER-01 이미지 한 장 → 페이지 = 이미지 크기(pt), 나눔 없음', () => {
    const g = pageGeometry('full', 2560, 4318);
    expect([g.pageW, g.pageH, g.sliceH]).toEqual([1920, 3238.5, 4318]);
  });

  // 목적: A4에서 그림이 여백을 넘거나 용지 크기가 틀리는 결함을 막는다
  it('[EP] TC-PAPER-02 A4 → 595.28x841.89pt, 그림 폭 = 용지 폭 - 여백 2개', () => {
    const g = pageGeometry('a4', 1000, 5000);
    expect([g.pageW, g.pageH]).toEqual([595.28, 841.89]);
    expect(1000 * g.scale + g.originX * 2).toBeCloseTo(595.28);
  });

  // 목적: 가로 방향을 골랐는데 세로 용지로 저장되는 결함을 막는다 (PR #1 요청)
  it('[EP] TC-PAPER-03 A4 + 가로 → 841.89x595.28pt, 한 쪽에 들어가는 높이가 세로보다 작음', () => {
    const portrait = pageGeometry('a4', 1000, 5000, 'portrait');
    const landscape = pageGeometry('a4', 1000, 5000, 'landscape');
    expect([landscape.pageW, landscape.pageH]).toEqual([841.89, 595.28]);
    expect(landscape.sliceH).toBeLessThan(portrait.sliceH);
  });

  // 목적: "전체 이미지"에 가로 방향을 적용해 이미지가 눕혀지는 결함을 막는다
  it('[EP] TC-PAPER-04 전체 이미지 + 가로 → 방향 무시, 이미지 크기 그대로', () => {
    const g = pageGeometry('full', 2560, 4318, 'landscape');
    expect([g.pageW, g.pageH]).toEqual([1920, 3238.5]);
  });
});

describe('mapLinks / linksForSlice: 누를 수 있는 링크 (SET-22)', () => {
  const link = { x: 100, y: 500, w: 200, h: 40, href: 'https://example.com/' };
  // 목적: 잘라 낸 영역 밖의 링크가 PDF에 남아 엉뚱한 곳이 눌리는 결함을 막는다
  it('[EP] TC-LINK-01 자른 영역 밖 링크 → 버림, 안쪽 링크 → 자른 위치만큼 옮김', () => {
    const crop = { x: 50, y: 400, w: 600, h: 300 };
    expect(mapLinks([link, { ...link, y: 900 }], crop, 0)).toEqual([{ x: 50, y: 100, w: 200, h: 40, href: link.href }]);
  });

  // 목적: 페이지 경계에 걸친 링크가 두 페이지 중 한 곳에서 빠지는 결함을 막는다
  it('[EP] TC-LINK-02 페이지 경계에 걸친 링크 → 두 페이지에 나뉘어 들어감', () => {
    const g = { pageW: 100, pageH: 100, originX: 0, originY: 0, scale: 1, sliceH: 510 };
    const a = linksForSlice([link], { y: 0, h: 510 }, g);
    const b = linksForSlice([link], { y: 510, h: 510 }, g);
    expect([a[0].h, b[0].h, b[0].y]).toEqual([10, 30, 0]);
  });

  // 목적: 한글 주소가 PDF 문자열을 깨뜨리는 결함을 막는다
  it('[EP] TC-LINK-03 한글·괄호가 든 주소 → ASCII로 인코딩, 괄호는 이스케이프', () => {
    expect(pdfUri('https://ko.wikipedia.org/wiki/캡처_(사진)')).toBe('https://ko.wikipedia.org/wiki/%EC%BA%A1%EC%B2%98_\\(%EC%82%AC%EC%A7%84\\)');
  });
});

describe('buildPdf: PDF 파일 구조', () => {
  // 목적: 목차(xref)의 위치 숫자가 실제 객체 위치와 어긋나 PDF가 안 열리는 결함을 막는다
  it('[EP] TC-PDFW-01 2페이지 + 링크 → 모든 xref 위치가 "N 0 obj"를 가리키고 페이지 수 2, 링크 포함', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]);
    const page = (y: number) => ({
      width: 612,
      height: 792,
      image: { jpeg, pxW: 10, pxH: 10, x: 36, y: 36, w: 540, h: 540 },
      links: y ? [{ x: 36, y, w: 100, h: 20, uri: 'https://example.com/' }] : [],
    });
    const bytes = buildPdf([page(0), page(50)]);
    const text = latin1(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(8);
    entries.forEach((off, i) => expect(text.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(text).toContain('/Count 2');
    expect(text).toContain('/URI (https://example.com/)');
    // 링크 위치: 위에서 50pt → PDF 좌표(아래에서) 792-50-20 = 722
    expect(text).toContain('/Rect [36 722 136 742]');
  });
});

describe('moveBreak / removeBreak: 미리보기에서 나누는 곳 고치기 (PR #1 세 번째 요청)', () => {
  // 목적: 나누는 곳을 너무 아래로 끌어 한 쪽이 용지에 안 들어가는(잘리는) 결함을 막는다
  it('[BVA] TC-BRK-01 한 쪽 높이 = 최대+1 위치로 끎 → 최대 높이에서 멈춤', () => {
    expect(moveBreak([1000, 2000], 0, 1001, 2500, 1000)[0]).toBe(1000);
  });

  // 목적: 나누는 곳을 앞 쪽 시작에 붙여 빈 페이지가 생기는 결함을 막는다
  it('[BVA] TC-BRK-02 한 쪽 높이 = 최소-1 위치로 끎 → 최소 높이에서 멈춤', () => {
    expect(moveBreak([1000, 2000], 1, 1000 + PAGE_MIN_PX - 1, 2500, 1000)[1]).toBe(1000 + PAGE_MIN_PX);
  });

  // 목적: 한 곳을 고쳤는데 사용자가 맞춰 둔 뒤쪽 나누는 곳까지 바뀌는 결함을 막는다
  it('[EP] TC-BRK-03 뒤쪽이 그대로 들어감 → 뒤쪽 나누는 곳은 그대로', () => {
    expect(moveBreak([1000, 1800], 0, 900, 2500, 1000)).toEqual([900, 1800]);
  });

  // 목적: 앞을 줄여 뒤쪽 한 쪽이 용지보다 길어졌는데 그대로 두어 내용이 잘리는 결함을 막는다
  it('[EP] TC-BRK-04 뒤쪽이 용지보다 길어짐 → 거기서부터 다시 나눔', () => {
    expect(moveBreak([1000, 2000], 0, 900, 2500, 1000)).toEqual([900, 1900]);
  });

  // 목적: 마지막 나누는 곳을 올렸을 때 마지막 쪽이 넘치는데 페이지를 늘리지 않는 결함을 막는다
  it('[EP] TC-BRK-05 마지막 쪽이 넘침 → 페이지가 하나 늘어남', () => {
    expect(moveBreak([1000], 0, 500, 2000, 1000)).toEqual([500, 1500]);
  });

  // 목적: 합쳐도 한 페이지에 들어가는데 합치기를 막는 결함을 막는다
  it('[BVA] TC-BRK-06 합친 높이 = 최대 → 합쳐짐', () => {
    expect(removeBreak([400, 1000], 0, 1500, 1000)).toEqual([1000]);
  });

  // 목적: 합치면 용지보다 길어 잘리는데 합쳐 버리는 결함을 막는다
  it('[BVA] TC-BRK-07 합친 높이 = 최대+1 → 합치지 않음(null)', () => {
    expect(removeBreak([400, 1001], 0, 1500, 1000)).toBeNull();
  });
});

describe('dominantColor: 남는 여백을 채울 색 (PR #1 세 번째 요청)', () => {
  // 목적: 어두운 바탕에 흰 글자가 조금 섞인 줄에서 글자색(흰색)으로 여백을 채워 이질감이 생기는 결함을 막는다
  it('[EP] TC-FILL-01 어두운 점 8개 + 흰 점 2개 → 어두운 색', () => {
    const px = [...Array(8).fill([18, 18, 18, 255]), ...Array(2).fill([255, 255, 255, 255])].flat();
    expect(dominantColor(new Uint8ClampedArray(px))).toEqual([18, 18, 18]);
  });
});

describe('buildPdf: 여백 채우기 (PR #1 세 번째 요청)', () => {
  // 목적: 채우기 명령이 그림 뒤에 들어가 그림을 덮거나, 길이 값이 어긋나 PDF가 안 열리는 결함을 막는다
  it('[EP] TC-PDFW-02 채울 사각형 1개 → 그림 앞에 색 채우기, 내용 길이(/Length)가 실제와 같음', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const text = latin1(
      buildPdf([
        {
          width: 612,
          height: 792,
          image: { jpeg, pxW: 10, pxH: 10, x: 36, y: 36, w: 540, h: 300 },
          links: [],
          fills: [{ x: 36, y: 336, w: 540, h: 420, rgb: [255, 0, 0] }],
        },
      ]),
    );
    const m = text.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/)!;
    expect(m[2].length).toBe(Number(m[1]));
    expect(m[2].startsWith('1 0 0 rg 36 36 540 420 re f q')).toBe(true);
  });
});
