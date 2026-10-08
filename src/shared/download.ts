// chrome.downloads로 파일을 기기에 저장한다 ("downloads" 권한)

/** 서비스 워커에는 URL.createObjectURL이 없으므로 data: 주소로 바꾼다 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export async function downloadBlob(blob: Blob, filename: string, saveAs: boolean): Promise<number> {
  const canObjectUrl = typeof URL.createObjectURL === 'function';
  const url = canObjectUrl ? URL.createObjectURL(blob) : await blobToDataUrl(blob);
  try {
    return await chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
  } finally {
    // 내려받기가 시작된 뒤에 주소를 풀어 준다
    if (canObjectUrl) setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
