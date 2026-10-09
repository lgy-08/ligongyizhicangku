import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { sendLl } from '../src/storage/client';
import type { LlRequest } from '../src/storage/protocol';
import { mountWeb } from '../src/web/mount';
import { WebLookup } from '../src/web/web-lookup';

/**
 * Injected on demand by the toolbar popup (activeTab + scripting) into the current tab only.
 * Not listed in the manifest, so the extension has no access to any site until the user clicks.
 * Stays active until the page is reloaded or the popup turns it off.
 */
type Handle = { dispose(): void };
const g = globalThis as typeof globalThis & { __llWebLookup?: Handle };

export default defineUnlistedScript(() => {
  if (g.__llWebLookup) return; // already active in this page
  const web = new WebLookup((msg) => sendLl((m: LlRequest) => browser.runtime.sendMessage(m), msg));
  const unmount = mountWeb(web);
  void web.start();
  g.__llWebLookup = {
    dispose() {
      web.dispose();
      unmount();
      delete g.__llWebLookup;
    },
  };
});
