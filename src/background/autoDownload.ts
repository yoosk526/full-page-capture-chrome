// 설정 "바로 파일로 내려받기"(SET-15): 결과 화면 없이 설정한 형식으로 곧바로 저장한다
import type { Settings } from '../core/settings';
import { exportShot } from '../render/exportShot';
import { downloadBlob } from '../shared/download';
import type { ShotRecord } from '../shared/types';

export async function autoDownloadShots(shots: ShotRecord[], settings: Settings): Promise<void> {
  for (const shot of shots) {
    const { blob, filename } = await exportShot(shot, settings.fileFormat, settings);
    // 저장 위치 묻기(SET-14)는 파일이 하나일 때만
    await downloadBlob(blob, filename, settings.askWhereToSave && shots.length === 1);
  }
}
