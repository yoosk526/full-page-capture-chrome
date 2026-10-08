// 스크린샷을 저장용 파일(Blob)로 만든다
import { hasEdits } from '../core/editorModel';
import { buildBaseFileName, buildDownloadPath } from '../core/fileName';
import type { FileFormat, Settings } from '../core/settings';
import type { ShotRecord } from '../shared/types';
import { renderToCanvas, type RenderSource } from './renderDoc';

export interface ExportResult {
  blob: Blob;
  filename: string;
}

export function shotBaseName(shot: ShotRecord): string {
  const base = buildBaseFileName(shot.url);
  return shot.partCount > 1 ? `${base}-${shot.partIndex + 1}` : base;
}

export async function loadSource(shot: ShotRecord): Promise<RenderSource & { image: ImageBitmap }> {
  const image = await createImageBitmap(shot.image);
  return { image, imageW: shot.width, imageH: shot.height, url: shot.url, capturedAt: shot.createdAt };
}

/** 편집 내용을 반영한 결과 이미지 캔버스 */
export async function renderShot(shot: ShotRecord): Promise<OffscreenCanvas> {
  const src = await loadSource(shot);
  try {
    return renderToCanvas(src, shot.doc);
  } finally {
    src.image.close();
  }
}

/** 편집 내용을 반영한 PNG. 편집하지 않았으면 원본을 그대로 쓴다 */
export async function renderShotPng(shot: ShotRecord): Promise<Blob> {
  if (!hasEdits(shot.doc)) return shot.image;
  return (await renderShot(shot)).convertToBlob({ type: 'image/png' });
}

export async function exportShot(shot: ShotRecord, format: FileFormat, settings: Settings): Promise<ExportResult> {
  const name = shotBaseName(shot);
  if (format === 'jpg') {
    const c = await renderShot(shot);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return { blob, filename: buildDownloadPath(settings.saveFolder, name, 'jpg') };
  }
  return { blob: await renderShotPng(shot), filename: buildDownloadPath(settings.saveFolder, name, 'png') };
}
