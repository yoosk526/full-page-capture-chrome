// 스크린샷을 저장용 파일(Blob)로 만든다
import { buildBaseFileName, buildDownloadPath } from '../core/fileName';
import type { FileFormat, Settings } from '../core/settings';
import type { ShotRecord } from '../shared/types';

export interface ExportResult {
  blob: Blob;
  filename: string;
}

export function shotBaseName(shot: ShotRecord): string {
  const base = buildBaseFileName(shot.url);
  return shot.partCount > 1 ? `${base}-${shot.partIndex + 1}` : base;
}

async function toCanvas(shot: ShotRecord): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(shot.image);
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  c.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return c;
}

export async function exportShot(shot: ShotRecord, format: FileFormat, settings: Settings): Promise<ExportResult> {
  const name = shotBaseName(shot);
  if (format === 'jpg') {
    const c = await toCanvas(shot);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    return { blob, filename: buildDownloadPath(settings.saveFolder, name, 'jpg') };
  }
  return { blob: shot.image, filename: buildDownloadPath(settings.saveFolder, name, 'png') };
}
