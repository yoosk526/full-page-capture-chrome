// 결과 화면·편집기·내 스크린샷에서 같이 쓰는 저장/복사/인쇄 동작
import type { FileFormat } from '../../core/settings';
import { downloadBlob } from '../../shared/download';
import { t } from '../../shared/i18n';
import { loadSettings } from '../../shared/settingsStore';
import type { ShotRecord } from '../../shared/types';
import { toast } from '../../shared/ui';
import { exportShot, renderShotPng } from '../../render/exportShot';

export async function saveShot(shot: ShotRecord, format: FileFormat, forceAsk = false): Promise<void> {
  try {
    const settings = await loadSettings();
    const { blob, filename } = await exportShot(shot, format, settings);
    await downloadBlob(blob, filename, forceAsk || settings.askWhereToSave);
    toast(t.toast.saved);
  } catch (e) {
    console.error(e);
    toast(t.toast.saveFailed);
  }
}

export async function copyShot(shot: ShotRecord): Promise<void> {
  try {
    const blob = await renderShotPng(shot);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(t.toast.copied);
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
