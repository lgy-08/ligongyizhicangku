import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { createDictLoader } from '../src/dict/loader';
import { createIdbStore } from '../src/storage/idb-store';
import { isLlMessage } from '../src/storage/protocol';
import { handleRequest, type SwInfo } from '../src/storage/router';

export default defineBackground(() => {
  // A fresh id per service-worker instance. If a later status call returns a different id,
  // Chrome terminated and restarted the worker in between.
  const sw: SwInfo = { instanceId: crypto.randomUUID(), startedAt: Date.now() };
  const store = createIdbStore();
  const getURL = browser.runtime.getURL as (path: string) => string;
  const loadDict = createDictLoader(getURL('/dict/ecdict-lite.json'));

  store.appendSwStart({ instanceId: sw.instanceId, startedAt: sw.startedAt }).catch((err) => {
    console.warn('[LinguaLens] failed to record SW start', err);
  });

  const deps = {
    store,
    sw,
    appVersion: browser.runtime.getManifest().version,
    getDict: async () => {
      const r = await loadDict();
      return { dict: r.dict, error: r.error };
    },
    openOptions: () => browser.runtime.openOptionsPage(),
  };

  // Registered synchronously at top level so Chrome can wake the worker for these events.
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isLlMessage(msg)) return false;
    if (sender.id !== browser.runtime.id) {
      sendResponse({ ok: false, error: 'sender not allowed' });
      return false;
    }
    handleRequest(msg, deps).then(sendResponse);
    return true; // keep the channel open for the async response
  });

  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });
});
