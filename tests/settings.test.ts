import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core/settings';

describe('normalizeSettings: 저장된 설정 검증 (SET-10 ~ SET-23)', () => {
  // 목적: 저장소가 비었을 때(처음 설치) 설정 화면·촬영이 멈추는 결함을 막는다
  it('[EP] TC-SETN-01 저장된 값 없음 → 기본값 전체', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  // 목적: 손상되거나 옛 버전의 값(모르는 형식, 잘못된 폴더)이 그대로 쓰여 저장이 실패하는 결함을 막는다
  it('[EP] TC-SETN-02 모르는 값·잘못된 값 → 그 항목만 기본값', () => {
    const s = normalizeSettings({ fileFormat: 'gif', scrollDelayMs: 7, saveFolder: '..', pdfLinks: false });
    expect(s.fileFormat).toBe('png');
    expect(s.scrollDelayMs).toBe(150);
    expect(s.saveFolder).toBe('');
    expect(s.pdfLinks).toBe(false);
  });
});
