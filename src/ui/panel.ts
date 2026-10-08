import { formatTimestamp } from '../captions/text';
import type { CaptionCue } from '../captions/types';
import { el } from './dom';

export interface PanelHandlers {
  onIncrement: () => void;
  onRead: () => void;
  onSwStatus: () => void;
  onFile: (file: File) => void;
  onClearCues: () => void;
  onCueClick: (cue: CaptionCue) => void;
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
  setImportMessage(text: string, isError: boolean): void;
  setCues(cues: readonly CaptionCue[]): void;
  highlightCue(id: string | null): void;
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
.err { color: #f88; }
.ok { color: #8d8; }
ol { margin: 0; padding: 0; list-style: none; max-height: 180px; overflow: auto; border: 1px solid #333; }
li { padding: 2px 4px; cursor: pointer; border-bottom: 1px solid #2a2a2a; }
li:hover { background: #2c2c2c; }
li.active { background: #264; }
li .t { color: #9ab; margin-right: 6px; font-family: ui-monospace, Consolas, monospace; }
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
  const head = el('div', { className: 'head' }, [el('b', { text: 'LinguaLens LL-001' }), status, toggle]);

  const player = el('pre', { text: '-' });
  const logPre = el('pre', { className: 'log' });
  const probe = el('pre', { text: '-' });
  const domCap = el('pre', { text: '-' });
  const storage = el('pre', { text: '-' });
  const importMsg = el('pre');
  const cueList = el('ol');
  const extra = el('div');

  const btn = (text: string, fn: () => void) => {
    const b = el('button', { text, type: 'button' });
    b.addEventListener('click', fn);
    return b;
  };
  const file = el('input', { type: 'file', accept: '.srt,.vtt,text/vtt' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) h.onFile(f);
    file.value = '';
  });

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
    el('section', {}, [
      el('h4', { text: 'Import SRT / VTT (exact timing)' }),
      file,
      btn('Clear', h.onClearCues),
      importMsg,
      cueList,
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
  const cueEls = new Map<string, HTMLLIElement>();
  let activeId: string | null = null;

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
    setImportMessage(t, isError) {
      importMsg.textContent = t;
      importMsg.className = isError ? 'err' : 'ok';
    },
    setCues(cues) {
      cueList.replaceChildren();
      cueEls.clear();
      activeId = null;
      for (const cue of cues) {
        const li = el('li', { title: `${cue.timingConfidence} · ${cue.source}` }, [
          el('span', { className: 't', text: formatTimestamp(cue.startMs) }),
          cue.text.replace(/\n/g, ' / '),
        ]);
        li.addEventListener('click', () => h.onCueClick(cue));
        cueEls.set(cue.id, li);
        cueList.append(li);
      }
    },
    highlightCue(id) {
      if (id === activeId) return;
      if (activeId) cueEls.get(activeId)?.classList.remove('active');
      activeId = id;
      const li = id ? cueEls.get(id) : undefined;
      if (li) {
        li.classList.add('active');
        li.scrollIntoView({ block: 'nearest' });
      }
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
