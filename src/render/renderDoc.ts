// 편집 문서를 캔버스에 그린다. 편집기 화면, 결과 화면 미리보기, 저장 파일이 모두 이 함수를 쓴다.
// 좌표: 호출하는 쪽이 ctx 변환을 "결과 이미지 px" 기준으로 맞춰 둔다.
import type { BlurObj, EditorDoc, EditorObject, PathObj, TextObj } from '../core/doc';
import { buildStamp, outputLayout, type OutputLayout, type StampContent } from '../core/stamp';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RenderSource {
  image: CanvasImageSource;
  imageW: number;
  imageH: number;
  url: string;
  capturedAt: number;
}

export interface RenderOptions {
  /** 자르기 모드: 원본 전체를 보여 주고 도장은 그리지 않는다 */
  fullImage?: boolean;
  /** 그리지 않을 개체 (글자를 고치는 중인 텍스트 등) */
  hidden?: Set<string>;
  /** 화면에 보이는 영역(결과 px). 주어지면 그 부분만 그려 빠르게 한다 */
  visible?: { x: number; y: number; w: number; h: number };
}

export function layoutFor(src: RenderSource, doc: EditorDoc, opts: RenderOptions = {}): OutputLayout {
  if (opts.fullImage) return outputLayout({ crop: null, stamp: { ...doc.stamp, position: 'none' } }, src.imageW, src.imageH);
  return outputLayout(doc, src.imageW, src.imageH);
}

export function renderDoc(ctx: Ctx, src: RenderSource, doc: EditorDoc, opts: RenderOptions = {}): OutputLayout {
  const L = layoutFor(src, doc, opts);
  const { crop } = L;

  // 원본 이미지 (보이는 부분만)
  let sx = crop.x;
  let sy = crop.y;
  let sw = crop.w;
  let sh = crop.h;
  if (opts.visible) {
    const vx0 = Math.max(0, Math.floor(opts.visible.x));
    const vy0 = Math.max(0, Math.floor(opts.visible.y - L.imageY));
    const vx1 = Math.min(crop.w, Math.ceil(opts.visible.x + opts.visible.w));
    const vy1 = Math.min(crop.h, Math.ceil(opts.visible.y - L.imageY + opts.visible.h));
    sx = crop.x + vx0;
    sy = crop.y + vy0;
    sw = vx1 - vx0;
    sh = vy1 - vy0;
  }
  if (sw > 0 && sh > 0) ctx.drawImage(src.image, sx, sy, sw, sh, sx - crop.x, sy - crop.y + L.imageY, sw, sh);

  // 개체: 원본 좌표 → 결과 좌표로 옮기고 이미지 영역 밖은 잘라 낸다
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, L.imageY, crop.w, crop.h);
  ctx.clip();
  ctx.translate(-crop.x, L.imageY - crop.y);
  for (const o of doc.objects) {
    if (opts.hidden?.has(o.id)) continue;
    drawObject(ctx, o, src);
  }
  ctx.restore();

  if (L.stamp && !opts.fullImage) {
    const content = buildStamp(doc.stamp.position, doc.stamp.dateFormat, src.url, new Date(src.capturedAt));
    if (content) drawStamp(ctx, content, 0, L.stamp.y, L.width, L.stamp.h);
  }
  return L;
}

// ---- 개체 그리기 ----

export function fontFor(size: number): string {
  return `${size}px system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
}

const LINE_HEIGHT = 1.25;
const TEXT_PAD = 0.25;
let measureCtx: OffscreenCanvasRenderingContext2D | null = null;

/** 텍스트 개체의 크기(배경 여백 포함) */
export function measureText(text: string, fontSize: number): { w: number; h: number } {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  measureCtx.font = fontFor(fontSize);
  const lines = (text || ' ').split('\n');
  const w = Math.max(...lines.map((l) => measureCtx!.measureText(l || ' ').width));
  const pad = fontSize * TEXT_PAD;
  return { w: Math.ceil(w + pad * 2), h: Math.ceil(lines.length * fontSize * LINE_HEIGHT + pad * 2) };
}

function drawObject(ctx: Ctx, o: EditorObject, src: RenderSource): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (o.type) {
    case 'rect': {
      ctx.beginPath();
      ctx.roundRect(o.x, o.y, o.w, o.h, Math.min(o.radius, o.w / 2, o.h / 2));
      if (o.fill) {
        ctx.fillStyle = o.fill;
        ctx.fill();
      }
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.max(0.5, o.w / 2), Math.max(0.5, o.h / 2), 0, 0, Math.PI * 2);
      if (o.fill) {
        ctx.fillStyle = o.fill;
        ctx.fill();
      }
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      ctx.stroke();
      break;
    }
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      ctx.stroke();
      break;
    }
    case 'arrow':
      drawArrow(ctx, o.x1, o.y1, o.x2, o.y2, o.width, o.color, o.heads === 'both');
      break;
    case 'text':
      drawText(ctx, o);
      break;
    case 'blur':
      drawBlur(ctx, o, src);
      break;
    case 'badge': {
      const r = Math.min(o.w, o.h) / 2;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = o.color;
      ctx.fill();
      ctx.fillStyle = o.color.toLowerCase() === '#ffffff' ? '#1e293b' : '#ffffff';
      ctx.font = `bold ${fontFor(Math.round(r * (o.number > 99 ? 0.8 : 1.05)))}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(o.number), cx, cy + r * 0.04);
      break;
    }
    case 'highlighter':
    case 'pen':
    case 'brush':
      drawPath(ctx, o);
      break;
  }
  ctx.restore();
}

function drawArrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, width: number, color: string, both: boolean): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const head = Math.min(len * 0.6, Math.max(12, width * 4));
  const spread = Math.PI / 7;
  // 화살촉 안쪽까지만 선을 그어 끝이 튀어나오지 않게 한다
  const inset = head * 0.6;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const sx = both ? x1 + ux * inset : x1;
  const sy = both ? y1 + uy * inset : y1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(x2 - ux * inset, y2 - uy * inset);
  ctx.stroke();
  const tip = (tx: number, ty: number, a: number) => {
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - head * Math.cos(a - spread), ty - head * Math.sin(a - spread));
    ctx.lineTo(tx - head * Math.cos(a + spread), ty - head * Math.sin(a + spread));
    ctx.closePath();
    ctx.fill();
  };
  tip(x2, y2, angle);
  if (both) tip(x1, y1, angle + Math.PI);
}

function drawText(ctx: Ctx, o: TextObj): void {
  const pad = o.fontSize * TEXT_PAD;
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.beginPath();
    ctx.roundRect(o.x, o.y, o.w, o.h, pad);
    ctx.fill();
  }
  ctx.fillStyle = o.color;
  ctx.font = fontFor(o.fontSize);
  ctx.textBaseline = 'top';
  o.text.split('\n').forEach((line, i) => {
    ctx.fillText(line, o.x + pad, o.y + pad + i * o.fontSize * LINE_HEIGHT + o.fontSize * 0.1);
  });
}

function drawPath(ctx: Ctx, o: PathObj): void {
  const p = o.points;
  if (p.length < 2) return;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.width;
  if (o.type === 'highlighter') {
    // TODO(미확인): 형광펜이 투명한지 모른다. 아래 글자가 비치도록 반투명 + 곱하기로 칠한다
    ctx.globalAlpha = 0.45;
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineCap = 'square';
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) {
    ctx.lineTo(p[0] + 0.01, p[1]);
  } else if (o.type === 'brush') {
    // TODO(미확인): 펜과 붓의 차이를 모른다. 붓은 점 사이를 곡선으로 부드럽게 잇고, 펜은 직선으로 잇는다
    for (let i = 2; i + 2 < p.length; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2;
      const my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  } else {
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  }
  ctx.stroke();
}

// ---- 가리기 (흐리게 / 모자이크) ----

/** 원본 이미지마다 따로 둔다(같은 위치의 가리기라도 다른 스크린샷이면 내용이 다르다) */
const blurCaches = new WeakMap<object, Map<string, OffscreenCanvas>>();

function cacheFor(image: CanvasImageSource): Map<string, OffscreenCanvas> {
  let c = blurCaches.get(image);
  if (!c) {
    c = new Map();
    blurCaches.set(image, c);
  }
  return c;
}

function blurredRegion(o: BlurObj, src: RenderSource): OffscreenCanvas | null {
  const x = Math.round(o.x);
  const y = Math.round(o.y);
  const w = Math.round(o.w);
  const h = Math.round(o.h);
  if (w < 1 || h < 1) return null;
  const key = `${x},${y},${w},${h},${o.strength},${o.mode}`;
  const blurCache = cacheFor(src.image);
  const hit = blurCache.get(key);
  if (hit) return hit;
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d')!;
  if (o.mode === 'blur') {
    // TODO(미확인): 두께 값과 흐림 정도의 관계를 모른다. 두께 1당 2px 반경으로 흐린다
    const radius = o.strength * 2;
    const pad = radius * 2;
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src.image, x - pad, y - pad, w + pad * 2, h + pad * 2, -pad, -pad, w + pad * 2, h + pad * 2);
  } else {
    // TODO(미확인): 두께 값과 모자이크 블록 크기의 관계를 모른다. 두께 1당 3px 블록
    const block = Math.max(2, o.strength * 3);
    const small = new OffscreenCanvas(Math.max(1, Math.ceil(w / block)), Math.max(1, Math.ceil(h / block)));
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingQuality = 'medium';
    sctx.drawImage(src.image, x, y, w, h, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, small.width * block, small.height * block);
  }
  if (blurCache.size > 40) blurCache.delete(blurCache.keys().next().value!);
  blurCache.set(key, out);
  return out;
}

function drawBlur(ctx: Ctx, o: BlurObj, src: RenderSource): void {
  const region = blurredRegion(o, src);
  if (region) ctx.drawImage(region, Math.round(o.x), Math.round(o.y));
}

// ---- 주소와 날짜 도장 (EXP-06) ----

function ellipsize(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function drawLock(ctx: Ctx, x: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.14);
  ctx.beginPath();
  ctx.arc(x + s / 2, cy - s * 0.12, s * 0.28, Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + s * 0.12, cy - s * 0.12, s * 0.76, s * 0.6, s * 0.1);
  ctx.fill();
  ctx.restore();
}

export function drawStamp(ctx: Ctx, s: StampContent, x: number, y: number, w: number, h: number): void {
  ctx.save();
  const text = '#3c4450';
  if (s.frame === 'band') {
    const font = Math.round(h * 0.42);
    const pad = h * 0.4;
    ctx.fillStyle = '#eceef1';
    ctx.fillRect(x, y, w, h);
    ctx.font = fontFor(font);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = text;
    const dateW = s.date ? ctx.measureText(s.date).width + pad : 0;
    ctx.textAlign = 'left';
    ctx.fillText(ellipsize(ctx, s.url, w - pad * 2 - dateW), x + pad, y + h / 2);
    if (s.date) {
      ctx.textAlign = 'right';
      ctx.fillText(s.date, x + w - pad, y + h / 2);
    }
  } else {
    const mac = s.frame === 'mac';
    const bar = h;
    const font = Math.round(bar * 0.3);
    ctx.fillStyle = mac ? '#e7e8eb' : '#f1f3f5';
    ctx.beginPath();
    if (mac) ctx.roundRect(x, y, w, bar, [bar * 0.28, bar * 0.28, 0, 0]);
    else ctx.rect(x, y, w, bar);
    ctx.fill();
    ctx.fillStyle = '#d3d6db';
    ctx.fillRect(x, y + bar - 1, w, 1);

    let left = x + bar * 0.4;
    let right = x + w - bar * 0.4;
    if (mac) {
      // 빨강·노랑·초록 점 3개
      const r = bar * 0.12;
      ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
        ctx.beginPath();
        ctx.arc(left + r + i * r * 3.2, y + bar / 2, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      });
      left += r * 2 + r * 3.2 * 2 + bar * 0.4;
    } else {
      // 최소화·최대화·닫기
      const s2 = bar * 0.16;
      const cy = y + bar / 2;
      ctx.strokeStyle = text;
      ctx.lineWidth = Math.max(1, bar * 0.03);
      const gap = bar * 0.75;
      const cx3 = right - s2;
      const cx2 = cx3 - gap;
      const cx1 = cx2 - gap;
      ctx.beginPath();
      ctx.moveTo(cx1 - s2, cy);
      ctx.lineTo(cx1 + s2, cy);
      ctx.strokeRect(cx2 - s2, cy - s2, s2 * 2, s2 * 2);
      ctx.moveTo(cx3 - s2, cy - s2);
      ctx.lineTo(cx3 + s2, cy + s2);
      ctx.moveTo(cx3 + s2, cy - s2);
      ctx.lineTo(cx3 - s2, cy + s2);
      ctx.stroke();
      right = cx1 - s2 - bar * 0.5;
    }
    // 주소창
    const boxH = bar * 0.56;
    const boxY = y + (bar - boxH) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(left, boxY, right - left, boxH, mac ? boxH / 2 : boxH * 0.2);
    ctx.fill();
    const lock = boxH * 0.5;
    const innerL = left + boxH * 0.45;
    drawLock(ctx, innerL, y + bar / 2 + lock * 0.12, lock, '#6b7480');
    ctx.font = fontFor(font);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = text;
    const pad = boxH * 0.45;
    const dateW = s.date ? ctx.measureText(s.date).width + pad : 0;
    const urlX = innerL + lock + boxH * 0.3;
    ctx.textAlign = 'left';
    ctx.fillText(ellipsize(ctx, s.url, right - pad - dateW - urlX), urlX, y + bar / 2);
    if (s.date) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#6b7480';
      ctx.fillText(s.date, right - pad, y + bar / 2);
    }
  }
  ctx.restore();
}

/** 결과 이미지 한 장을 새 캔버스에 그린다 (저장·복사·인쇄·미리보기용) */
export function renderToCanvas(src: RenderSource, doc: EditorDoc): OffscreenCanvas {
  const L = layoutFor(src, doc);
  const canvas = new OffscreenCanvas(L.width, L.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, L.width, L.height);
  renderDoc(ctx, src, doc);
  return canvas;
}

/** 목록용 썸네일(폭 400px, 위쪽 부분)을 편집 내용까지 반영해 만든다 (GAL-02) */
export async function renderThumb(src: RenderSource, doc: EditorDoc): Promise<Blob> {
  const W = 400;
  const L = layoutFor(src, doc);
  const ratio = W / L.width;
  const h = Math.min(300, Math.max(1, Math.round(L.height * ratio)));
  const canvas = new OffscreenCanvas(W, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, h);
  ctx.scale(ratio, ratio);
  ctx.imageSmoothingQuality = 'high';
  renderDoc(ctx, src, doc, { visible: { x: 0, y: 0, w: L.width, h: h / ratio } });
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}
