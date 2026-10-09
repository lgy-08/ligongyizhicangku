export type PageKind = 'web' | 'youtube' | 'unsupported';

/**
 * What the toolbar popup can do on a page:
 * - youtube: handled automatically by the YouTube overlay (web lookup is not offered, it would
 *   fight with the player's double-click-to-fullscreen);
 * - web: http(s) / file pages where the lookup script can be injected;
 * - unsupported: browser pages, extension pages, the Web Store, unknown URL.
 */
export function classifyPage(url: string | undefined): PageKind {
  if (!url) return 'unsupported';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'unsupported';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return 'unsupported';
  if (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) {
    return 'unsupported';
  }
  if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') return 'youtube';
  return 'web';
}
