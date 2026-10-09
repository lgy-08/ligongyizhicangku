import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { BRIDGE_REQ, createBridgeHandler, type BridgeRequest } from '../src/web/translator';

/**
 * Injected into the page's MAIN world by the popup together with web-lookup.js, only as a fallback
 * for when Chrome's Translator API is not reachable from the extension's isolated world.
 * It only answers translation requests; it reads nothing from the page and sends nothing anywhere.
 */
const FLAG = '__lingualensTranslatorBridge';

export default defineUnlistedScript(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w[FLAG]) return;
  w[FLAG] = true;
  const handle = createBridgeHandler(() => (window as unknown as { Translator?: never }).Translator);
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as BridgeRequest | null;
    if (!d || d.type !== BRIDGE_REQ || typeof d.id !== 'string') return;
    void handle(d, (msg) => window.postMessage(msg, '*'));
  });
});
