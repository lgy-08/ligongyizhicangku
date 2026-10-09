import { createRoot } from 'react-dom/client';
import cardCss from '../content/ui/card.css?inline';
import webCss from './web.css?inline';
import type { WebLookup } from './web-lookup';
import { WebApp } from './WebApp';

/** Events from our card/notice must not reach the page (its click handlers, shortcuts, selection logic). */
const POINTER_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu', 'wheel'];
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

/** Mounts the lookup layer in a shadow root on <html>, isolated from page CSS. Returns an unmount function. */
export function mountWeb(web: WebLookup, doc: Document = document): () => void {
  const host = doc.createElement('div');
  host.setAttribute('data-lingualens', 'web-lookup');
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none' });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `${webCss}\n${cardCss}`;
  const mountPoint = doc.createElement('div');
  shadow.append(style, mountPoint);
  for (const type of [...POINTER_EVENTS, ...KEY_EVENTS]) host.addEventListener(type, (e) => e.stopPropagation());
  doc.documentElement.append(host);
  const root = createRoot(mountPoint);
  root.render(<WebApp web={web} />);
  return () => {
    root.unmount();
    host.remove();
  };
}
