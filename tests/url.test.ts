import { describe, expect, it } from 'vitest';
import { getWatchVideoId } from '../src/youtube/url';

describe('getWatchVideoId', () => {
  it('accepts standard watch pages', () => {
    expect(getWatchVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getWatchVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1')).toBe('dQw4w9WgXcQ');
    expect(getWatchVideoId(new URL('https://youtube.com/watch?v=abcdefghij_'))).toBe('abcdefghij_');
  });

  it('rejects non-watch pages and malformed input', () => {
    for (const u of [
      'https://www.youtube.com/',
      'https://www.youtube.com/results?search_query=x',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/watch?v=short',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://evil.example/watch?v=dQw4w9WgXcQ',
      'not a url',
    ]) {
      expect(getWatchVideoId(u), u).toBeNull();
    }
  });
});
