import type { CustomDefinition, VocabRecord, VocabStatus } from '../vocab/types';
import type { KvRecord, SwStartEntry } from './protocol';
import type { Store } from './router';

/**
 * IndexedDB-backed Store. Runs ONLY in the background service worker (extension origin).
 * The connection promise is cached per service-worker instance; when Chrome terminates the
 * worker, the next instance opens a new connection.
 *
 * Schema history:
 *   v1 (LL-001): kv, sw_log
 *   v2 (LL-002): + vocab (keyPath lemma), custom_defs (keyPath lemma)
 */
export const DB_NAME = 'lingualens';
export const DB_VERSION = 2;
const KV = 'kv';
const SW_LOG = 'sw_log';
const VOCAB = 'vocab';
const DEFS = 'custom_defs';
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

export interface IdbStoreOptions {
  dbName?: string;
  /** Clock for createdAt/updatedAt; injectable for tests. */
  now?: () => number;
}

export function createIdbStore(factory: IDBFactory = indexedDB, options: IdbStoreOptions = {}): Store {
  const dbName = options.dbName ?? DB_NAME;
  const now = options.now ?? Date.now;
  let dbPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Additive only: never drop stores, so user data survives upgrades.
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SW_LOG)) db.createObjectStore(SW_LOG, { autoIncrement: true });
        if (!db.objectStoreNames.contains(VOCAB)) db.createObjectStore(VOCAB, { keyPath: 'lemma' });
        if (!db.objectStoreNames.contains(DEFS)) db.createObjectStore(DEFS, { keyPath: 'lemma' });
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

  const getAll = async <T>(storeName: string): Promise<T[]> => {
    const db = await open();
    return (await reqToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll())) as T[];
  };

  return {
    // ---- kv (LL-001) ----
    async get(key) {
      const db = await open();
      return (await reqToPromise(db.transaction(KV, 'readonly').objectStore(KV).get(key))) as KvRecord | undefined;
    },
    async put(key, value) {
      const db = await open();
      const tx = db.transaction(KV, 'readwrite');
      const rec: KvRecord = { key, value, updatedAt: now() };
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
      let rec: KvRecord = { key, value: 1, updatedAt: now() };
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const prev = (getReq.result as KvRecord | undefined)?.value;
        rec = { key, value: (typeof prev === 'number' ? prev : 0) + 1, updatedAt: now() };
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
      return (await getAll<SwStartEntry>(SW_LOG)).slice(-limit);
    },

    // ---- vocab (LL-002) ----
    async getVocabMany(lemmas) {
      const out = new Map<string, VocabRecord>();
      if (lemmas.length === 0) return out;
      const db = await open();
      const tx = db.transaction(VOCAB, 'readonly');
      const store = tx.objectStore(VOCAB);
      for (const l of lemmas) {
        const r = store.get(l);
        r.onsuccess = () => {
          if (r.result) out.set(l, r.result as VocabRecord);
        };
      }
      await txDone(tx);
      return out;
    },
    async setVocab(lemma: string, status: VocabStatus | null, word?: string) {
      const db = await open();
      const tx = db.transaction(VOCAB, 'readwrite');
      const store = tx.objectStore(VOCAB);
      let result: VocabRecord | null = null;
      if (status === null) {
        store.delete(lemma);
      } else {
        const getReq = store.get(lemma);
        getReq.onsuccess = () => {
          const prev = getReq.result as VocabRecord | undefined;
          const t = now();
          result = {
            lemma,
            status,
            createdAt: prev?.createdAt ?? t,
            updatedAt: t,
            ...(word ?? prev?.lastWord ? { lastWord: word ?? prev?.lastWord } : {}),
          };
          store.put(result);
        };
      }
      await txDone(tx);
      return result;
    },
    listVocab: () => getAll<VocabRecord>(VOCAB),
    async getCustomDef(lemma) {
      const db = await open();
      return (await reqToPromise(db.transaction(DEFS, 'readonly').objectStore(DEFS).get(lemma))) as CustomDefinition | undefined;
    },
    async setCustomDef(lemma, text) {
      const db = await open();
      const tx = db.transaction(DEFS, 'readwrite');
      const trimmed = text.trim();
      let rec: CustomDefinition | null = null;
      if (!trimmed) tx.objectStore(DEFS).delete(lemma);
      else {
        rec = { lemma, text: trimmed, updatedAt: now() };
        tx.objectStore(DEFS).put(rec);
      }
      await txDone(tx);
      return rec;
    },
    listCustomDefs: () => getAll<CustomDefinition>(DEFS),
    async putMany(vocab, defs) {
      if (vocab.length === 0 && defs.length === 0) return;
      const db = await open();
      const tx = db.transaction([VOCAB, DEFS], 'readwrite');
      for (const v of vocab) tx.objectStore(VOCAB).put(v);
      for (const d of defs) tx.objectStore(DEFS).put(d);
      await txDone(tx);
    },
  };
}
