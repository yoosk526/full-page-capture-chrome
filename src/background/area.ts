// "페이지 일부" 촬영 (PR #1 요청): 영역 고르기 화면을 넣고, 고른 영역만 잘라 보관한다
import { areaToPixels } from '../core/area';
import { emptyDoc } from '../core/doc';
import { newId, putShot } from '../shared/db';
import type { AreaSelected } from '../shared/messages';
import { loadSettings } from '../shared/settingsStore';
import type { ShotRecord } from '../shared/types';
import { autoDownloadShots } from './autoDownload';
import { makeThumb } from './stitcher';

export async function startAreaSelect(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['area.js'] });
}

/** 보이는 화면을 찍고 고른 영역만 잘라 보관한 뒤 결과 화면을 연다 */
export async function captureArea(tab: chrome.tabs.Tab, msg: AreaSelected): Promise<ShotRecord> {
  const settings = await loadSettings();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const scale = bitmap.width / msg.viewportWidth;
    const px = areaToPixels(msg.rect, scale, bitmap.width, bitmap.height);
    if (!px) throw new Error('area too small');
    const canvas = new OffscreenCanvas(px.w, px.h);
    canvas.getContext('2d')!.drawImage(bitmap, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
    const shot: ShotRecord = {
      id: newId(),
      groupId: newId(),
      partIndex: 0,
      partCount: 1,
      createdAt: Date.now(),
      url: msg.url,
      title: msg.title,
      width: px.w,
      height: px.h,
      image: await canvas.convertToBlob({ type: 'image/png' }),
      thumb: await makeThumb(canvas),
      doc: emptyDoc({ position: settings.stampPosition, dateFormat: settings.stampDateFormat }),
      links: [], // TODO(추정): 페이지 일부 촬영에는 PDF 링크를 넣지 않는다
    };
    await putShot(shot);
    if (settings.autoDownload) await autoDownloadShots([shot], settings);
    else await chrome.tabs.create({ url: chrome.runtime.getURL(`result.html?id=${shot.id}`), index: tab.index + 1 });
    return shot;
  } finally {
    bitmap.close();
  }
}
