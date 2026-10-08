const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Returns the video id for a standard YouTube watch page (https://www.youtube.com/watch?v=ID),
 * otherwise null. Shorts, embeds, live chat, home, search etc. are deliberately excluded in LL-001.
 */
export function getWatchVideoId(url: string | URL): string | null {
  let u: URL;
  try {
    u = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return null;
  }
  if (u.hostname !== 'www.youtube.com' && u.hostname !== 'youtube.com') return null;
  if (u.pathname !== '/watch') return null;
  const v = u.searchParams.get('v');
  return v && VIDEO_ID_RE.test(v) ? v : null;
}
