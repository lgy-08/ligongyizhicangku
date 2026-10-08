/** Mimics the structure YouTube renders for captions (observed shape; not a stable API). */
export function renderCaption(root: Element, lines: string[] | null): HTMLElement | null {
  root.querySelector('.ytp-caption-window-container')?.remove();
  if (!lines) return null;
  const container = document.createElement('div');
  container.className = 'ytp-caption-window-container';
  const win = document.createElement('div');
  win.className = 'caption-window';
  for (const l of lines) {
    const line = document.createElement('span');
    line.className = 'caption-visual-line';
    const seg = document.createElement('span');
    seg.className = 'ytp-caption-segment';
    seg.textContent = l;
    line.append(seg);
    win.append(line);
  }
  container.append(win);
  root.append(container);
  return container;
}

export function renderCcButton(root: Element, pressed: boolean): HTMLButtonElement {
  let btn = root.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'ytp-subtitles-button';
    root.append(btn);
  }
  btn.setAttribute('aria-pressed', String(pressed));
  return btn;
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
