import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractTrackInfo, PROBE_REQUEST, PROBE_RESULT, type TrackProbeResult } from '../src/youtube/track-probe';

/**
 * MAIN-world probe. Runs in the page's JS context only to read caption-track METADATA
 * from YouTube's player object, on request from the isolated content script.
 * It never fetches anything, never reads cookies/tokens, and never forwards baseUrl.
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data as { type?: unknown; nonce?: unknown } | null;
      if (!d || d.type !== PROBE_REQUEST || typeof d.nonce !== 'string') return;

      let result: TrackProbeResult;
      try {
        const player = document.getElementById('movie_player') as (HTMLElement & { getPlayerResponse?: () => unknown }) | null;
        const initial = (window as unknown as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
        if (player && typeof player.getPlayerResponse === 'function') {
          result = extractTrackInfo(player.getPlayerResponse(), 'movie_player.getPlayerResponse');
        } else if (initial) {
          result = extractTrackInfo(initial, 'ytInitialPlayerResponse');
        } else {
          result = { ok: false, via: 'none', responseVideoId: null, tracks: [], translationLanguageCount: 0, error: 'player API not found' };
        }
      } catch (err) {
        result = {
          ok: false,
          via: 'none',
          responseVideoId: null,
          tracks: [],
          translationLanguageCount: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      window.postMessage({ type: PROBE_RESULT, nonce: d.nonce, result }, location.origin);
    });
  },
});
