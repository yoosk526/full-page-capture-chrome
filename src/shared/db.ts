// 촬영 결과를 이 기기 안(IndexedDB)에 보관한다 (GAL-04).
// "unlimitedStorage" 권한이 있어 저장 용량 한도와 저장 공간 부족 시 자동 삭제(eviction)에서 제외된다.
import type { ShotRecord } from './types';

const DB_NAME = 'hanjang-capture';
const DB_VERSION = 1;
const STORE = 'shots';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function putShot(shot: ShotRecord): Promise<void> {
  await promisify((await tx('readwrite')).put(shot));
}

export async function getShot(id: string): Promise<ShotRecord | undefined> {
  return promisify((await tx('readonly')).get(id)) as Promise<ShotRecord | undefined>;
}

/** 최신 촬영이 맨 앞 */
export async function listShots(): Promise<ShotRecord[]> {
  const all = (await promisify((await tx('readonly')).getAll())) as ShotRecord[];
  return all.sort((a, b) => b.createdAt - a.createdAt || a.partIndex - b.partIndex);
}

export async function listGroup(groupId: string): Promise<ShotRecord[]> {
  const all = await listShots();
  return all.filter((s) => s.groupId === groupId).sort((a, b) => a.partIndex - b.partIndex);
}

export async function updateShot(id: string, patch: Partial<ShotRecord>): Promise<void> {
  const store = await tx('readwrite');
  const cur = (await promisify(store.get(id))) as ShotRecord | undefined;
  if (!cur) return;
  await promisify(store.put({ ...cur, ...patch, id }));
}

export async function deleteShots(ids: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const id of ids) store.delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function newId(): string {
  return crypto.randomUUID();
}
