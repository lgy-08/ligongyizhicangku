import { el } from './dom';

/** LL-001 diagnostics panel. Hidden unless "显示诊断面板" is enabled in settings. */
export interface PanelHandlers {
  onIncrement: () => void;
  onRead: () => void;
  onSwStatus: () => void;
  onCopyDiagnostics: () => void;
}

export interface Panel {
  setVisible(visible: boolean): void;
  setStatus(text: string): void;
  setPlayer(text: string): void;
  log(line: string): void;
  setProbe(text: string): void;
  setDomCaption(text: string): void;
  setStorage(text: string): void;
  showText(text: string): void;
  destroy(): void;
}

const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 12px; bottom: 12px; z-index: 2147483000; width: 360px; max-height: 70vh;
  display: flex; flex-direction: column; font: 12px/1.4 system-ui, sans-serif; color: #e8e8e8;
  background: rgba(20,20,20,.94); border: 1px solid #444; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
.wrap.collapsed { width: auto; }
.wrap.collapsed .body { display: none; }
.head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #333; cursor: pointer; user-select: none; }
.head b { flex: 1; }
.body { overflow: auto; padding: 6px 8px; }
section { margin-bottom: 8px; }
h4 { margin: 4px 0; font-size: 11px; text-transform: uppercase; color: #9ab; letter-spacing: .04em; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 11px/1.35 ui-monospace, Consolas, monospace; color: #ddd; }
button { font: inherit; color: #eee; background: #333; border: 1px solid #555; border-radius: 4px; padding: 2px 8px; cursor: pointer; margin: 2px 4px 2px 0; }
button:hover { background: #444; }
.log { max-height: 120px; overflow: auto; }
textarea { width: 100%; height: 120px; font: 10px ui-monospace, Consolas, monospace; background: #111; color: #ddd; }
`;

export function createPanel(h: PanelHandlers): Panel {
  const host = el('div');
  host.setAttribute('data-lingualens', 'll001-panel');
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style', { text: CSS });

  const status = el('span', { text: 'idle' });
  const toggle = el('span', { text: '−' });
  const head = el('div', { className: 'head' }, [el('b', { text: 'LinguaLens diagnostics' }), status, toggle]);

  const player = el('pre', { text: '-' });
  const logPre = el('pre', { className: 'log' });
  const probe = el('pre', { text: '-' });
  const domCap = el('pre', { text: '-' });
  const storage = el('pre', { text: '-' });
  const extra = el('div');

  const btn = (text: string, fn: () => void) => {
    const b = el('button', { text, type: 'button' });
    b.addEventListener('click', fn);
    return b;
  };

  const body = el('div', { className: 'body' }, [
    el('section', {}, [el('h4', { text: 'Player' }), player]),
    el('section', {}, [el('h4', { text: 'Events' }), logPre]),
    el('section', {}, [el('h4', { text: 'Caption tracks (metadata only)' }), probe]),
    el('section', {}, [el('h4', { text: 'YouTube on-screen caption (DOM, estimated)' }), domCap]),
    el('section', {}, [
      el('h4', { text: 'Storage channel (IndexedDB in SW)' }),
      btn('Counter +1', h.onIncrement),
      btn('Read counter', h.onRead),
      btn('SW status', h.onSwStatus),
      storage,
    ]),
    el('section', {}, [btn('Copy diagnostics JSON', h.onCopyDiagnostics), extra]),
  ]);

  const wrap = el('div', { className: 'wrap' }, [head, body]);
  head.addEventListener('click', () => {
    wrap.classList.toggle('collapsed');
    toggle.textContent = wrap.classList.contains('collapsed') ? '+' : '−';
  });
  root.append(style, wrap);
  (document.body ?? document.documentElement).append(host);

  const logLines: string[] = [];
  return {
    setVisible(v) {
      host.style.display = v ? '' : 'none';
    },
    setStatus(t) {
      status.textContent = t;
    },
    setPlayer(t) {
      player.textContent = t;
    },
    log(line) {
      logLines.push(line);
      if (logLines.length > 40) logLines.shift();
      logPre.textContent = logLines.join('\n');
      logPre.scrollTop = logPre.scrollHeight;
    },
    setProbe(t) {
      probe.textContent = t;
    },
    setDomCaption(t) {
      domCap.textContent = t;
    },
    setStorage(t) {
      storage.textContent = t;
    },
    showText(t) {
      const ta = el('textarea');
      ta.value = t;
      extra.replaceChildren(ta);
      ta.select();
    },
    destroy() {
      host.remove();
    },
  };
}
