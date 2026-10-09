import { createRoot } from 'react-dom/client';
import type { OverlayController } from './overlay-controller';
import cardCss from './ui/card.css?inline';
import overlayCss from './ui/overlay.css?inline';
import { App } from './ui/App';

/** Pointer events that must not reach YouTube's player handlers (click = play/pause, dblclick = fullscreen). */
const POINTER_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu', 'wheel'];
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

/**
 * Mounts the overlay inside YouTube's player container so it stays visible in fullscreen.
 * The host covers the player with pointer-events: none; only our controls receive pointer events.
 * Returns an unmount function.
 */
export function mountOverlay(container: Element, ctl: OverlayController): () => void {
  const host = document.createElement('div');
  host.setAttribute('data-lingualens', 'overlay');
  Object.assign(host.style, { position: 'absolute', inset: '0', zIndex: '60', pointerEvents: 'none' });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${overlayCss}\n${cardCss}`;
  const mountPoint = document.createElement('div');
  shadow.append(style, mountPoint);

  for (const type of POINTER_EVENTS) host.addEventListener(type, (e) => e.stopPropagation());
  // Keys typed into our text fields must not trigger YouTube shortcuts (k, f, m, space, digits...).
  for (const type of KEY_EVENTS) {
    host.addEventListener(type, (e) => {
      const target = e.composedPath()[0];
      if (target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) {
        e.stopPropagation();
      }
    });
  }

  container.append(host);
  const root = createRoot(mountPoint);
  root.render(<App ctl={ctl} />);
  return () => {
    root.unmount();
    host.remove();
  };
}
