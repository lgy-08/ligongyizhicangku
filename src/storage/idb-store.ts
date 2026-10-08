import type { KvRecord, SwStartEntry } from './protocol';
import type { KvStore } from './router';

/**
 * IndexedDB-backed KvStore. Runs ONLY in the background service worker.
 * The connection promise is cached per service-worker instance; when Chrome terminates the
 * worker, the next instance simply opens a new connection.
 */
const DB_NAME = 'lingualens';
const DB_VERSION = 1;
const KV = 'kv';
const SW_LOG = 'sw_log';
const SW_LOG_KEEP = 50;

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function createIdbKvStore(factory: IDBFactory = indexedDB): KvStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SW_LOG)) db.createObjectStore(SW_LOG, { autoIncrement: true });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('IndexedDB open blocked by another connection'));
      };
    });
    return dbPromise;
  };

  return {
    async get(key) {
      const db = await open();
      const rec = await reqToPromise(db.transaction(KV, 'readonly').objectStore(KV).get(key));
      return rec as KvRecord | undefined;
    },
    async put(key, value) {
      const db = await open();
      const tx = db.transaction(KV, 'readwrite');
      const rec: KvRecord = { key, value, updatedAt: Date.now() };
      tx.objectStore(KV).put(rec);
      await txDone(tx);
      return rec;
    },
    async delete(key) {
      const db = await open();
      const tx = db.transaction(KV, 'readwrite');
      tx.objectStore(KV).delete(key);
      await txDone(tx);
    },
    async increment(key) {
      const db = await open();
      const tx = db.transaction(KV, 'readwrite');
      const store = tx.objectStore(KV);
      let rec: KvRecord = { key, value: 1, updatedAt: Date.now() };
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const prev = (getReq.result as KvRecord | undefined)?.value;
        rec = { key, value: (typeof prev === 'number' ? prev : 0) + 1, updatedAt: Date.now() };
        store.put(rec);
      };
      await txDone(tx);
      return rec;
    },
    async appendSwStart(entry: SwStartEntry) {
      const db = await open();
      const tx = db.transaction(SW_LOG, 'readwrite');
      const store = tx.objectStore(SW_LOG);
      store.add(entry);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = keysReq.result;
        for (const k of keys.slice(0, Math.max(0, keys.length - SW_LOG_KEEP))) store.delete(k);
      };
      await txDone(tx);
    },
    async recentSwStarts(limit) {
      const db = await open();
      const all = (await reqToPromise(db.transaction(SW_LOG, 'readonly').objectStore(SW_LOG).getAll())) as SwStartEntry[];
      return all.slice(-limit);
    },
  };
}
