// 결과 화면·편집기·내 스크린샷에서 같이 쓰는 저장/복사/인쇄 동작
import type { FileFormat } from '../../core/settings';
import { downloadBlob } from '../../shared/download';
import { t } from '../../shared/i18n';
import { loadSettings } from '../../shared/settingsStore';
import type { ShotRecord } from '../../shared/types';
import { toast } from '../../shared/ui';
import { exportShot, renderShot, renderShotPng, shotBaseName } from '../../render/exportShot';
import { buildDownloadPath } from '../../core/fileName';
import { openPdfPreview } from './pdfPreview';
import { needsShrink, shrinkSize } from '../../core/copySize';
import { outputLayout } from '../../core/stamp';

export async function saveShot(shot: ShotRecord, format: FileFormat, forceAsk = false): Promise<void> {
  try {
    const settings = await loadSettings();
    if (format === 'pdf' && settings.pdfPreview) {
      // PDF는 먼저 페이지가 나뉘는 모양을 보여 주고 고칠 수 있게 한다 (PR #1 세 번째 요청)
      const blob = await openPdfPreview(await renderShot(shot), shot, settings);
      if (!blob) return;
      await downloadBlob(blob, buildDownloadPath(settings.saveFolder, shotBaseName(shot), 'pdf'), forceAsk || settings.askWhereToSave);
      toast(t.toast.saved);
      return;
    }
    const { blob, filename } = await exportShot(shot, format, settings);
    await downloadBlob(blob, filename, forceAsk || settings.askWhereToSave);
    toast(t.toast.saved);
  } catch (e) {
    console.error(e);
    toast(t.toast.saveFailed);
  }
}

/** 복사할 PNG. 2,500만 픽셀을 넘고 설정이 켜져 있으면 줄인다 (EXP-04, SET-16) */
async function copyBlob(shot: ShotRecord): Promise<{ blob: Blob; shrunk: boolean }> {
  const settings = await loadSettings();
  const L = outputLayout(shot.doc, shot.width, shot.height);
  if (!needsShrink(L.width, L.height, settings.shrinkCopy)) return { blob: await renderShotPng(shot), shrunk: false };
  const full = await renderShot(shot);
  const size = shrinkSize(L.width, L.height);
  const small = new OffscreenCanvas(size.width, size.height);
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, size.width, size.height);
  return { blob: await small.convertToBlob({ type: 'image/png' }), shrunk: true };
}

export async function copyShot(shot: ShotRecord): Promise<void> {
  try {
    const result = copyBlob(shot);
    // 그림을 만드는 동안 사용자 동작(클릭)의 유효 시간이 지나지 않도록 Promise를 그대로 넘긴다
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': result.then((r) => r.blob) })]);
    toast((await result).shrunk ? t.toast.copiedShrunk : t.toast.copied);
  } catch (e) {
    console.error(e);
    toast(t.toast.copyFailed);
  }
}

export async function printShot(shot: ShotRecord): Promise<void> {
  const img = document.getElementById('print-img') as HTMLImageElement;
  const url = URL.createObjectURL(await renderShotPng(shot));
  img.onload = () => {
    window.print();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
