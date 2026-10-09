import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { formatTimestamp } from '../../captions/text';
import { MAX_SELECTION_WORDS } from '../../dict/phrases';
import { tokenize } from '../../dict/tokenize';
import type { OverlayController } from '../overlay-controller';
import { captionMode, wordClass, type CardPosition, type OverlayState } from '../overlay-state';
import { WordCard } from './WordCard';

export const CARD_WIDTH = 320;
type WordRenderer = (text: string, lineKey: string) => ReactNode;
/** Prevents buttons from taking focus, so Space / K / F keep controlling the YouTube player. */
const noFocus = (e: MouseEvent) => e.preventDefault();

/**
 * Where the card goes. For words in the subtitle box the card sits ABOVE THE WHOLE BOX and its
 * height is capped to the space above it, so it never covers any English subtitle line.
 * Words in the upper half (e.g. in the list) open the card below them.
 */
function placeCard(root: HTMLElement, anchor: DOMRect, anchorEl: Element): CardPosition {
  const r = root.getBoundingClientRect();
  const center = anchor.left + anchor.width / 2 - r.left;
  const x = Math.max(8, Math.min(center - CARD_WIDTH / 2, r.width - CARD_WIDTH - 8));
  const box = anchorEl.closest('.sub-box');
  if (box) {
    const b = box.getBoundingClientRect();
    return { x, bottom: r.bottom - b.top + 6, top: null, maxHeight: Math.max(100, b.top - r.top - 12) };
  }
  if (anchor.top - r.top < r.height / 2) {
    const top = anchor.bottom - r.top + 6;
    return { x, top, bottom: null, maxHeight: Math.max(100, r.height - top - 8) };
  }
  return { x, bottom: r.bottom - anchor.top + 6, top: null, maxHeight: Math.max(100, anchor.top - r.top - 12) };
}

const unionRect = (a: DOMRect, b: DOMRect): DOMRect => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top);
};

interface Drag {
  lineKey: string;
  text: string;
  anchor: number;
  current: number;
  anchorEl: HTMLElement;
  currentEl: HTMLElement;
}

export function App({ ctl }: { ctl: OverlayController }) {
  const s = useSyncExternalStore(ctl.store.subscribe, ctl.store.get);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragSel, setDragSel] = useState<{ lineKey: string; text: string; from: number; to: number } | null>(null);

  /**
   * Mouse down on a word starts a selection; releasing on the same word opens the word card,
   * releasing on another word of the same line opens the phrase card for the whole range.
   */
  const finishDrag = () => {
    const d = drag.current;
    drag.current = null;
    setDragSel(null);
    const root = rootRef.current;
    if (!d || !root) return;
    if (d.current === d.anchor) {
      const pos = placeCard(root, d.anchorEl.getBoundingClientRect(), d.anchorEl);
      void ctl.openCard(d.anchorEl.textContent ?? '', pos, { lineKey: d.lineKey, text: d.text, from: d.anchor, to: d.anchor });
      return;
    }
    const from = Math.min(d.anchor, d.current);
    const to = Math.max(d.anchor, d.current);
    const pos = placeCard(root, unionRect(d.anchorEl.getBoundingClientRect(), d.currentEl.getBoundingClientRect()), d.anchorEl);
    void ctl.openPhraseCard({ lineKey: d.lineKey, text: d.text, from, to }, pos);
  };

  useEffect(() => {
    // Releases over the video (outside our elements) reach the window; releases on our elements are
    // stopped at the shadow host, so the root's onMouseUp below handles those.
    const up = () => {
      if (drag.current) finishDrag();
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  });

  const onWordDown = (e: MouseEvent<HTMLSpanElement>, lineKey: string, text: string, wi: number) => {
    e.preventDefault(); // no focus, no native text selection
    e.stopPropagation();
    if (e.button !== 0) return;
    const t = s.card?.target;
    // Shift+click extends from the word the card is open for (same line) to this word.
    if (e.shiftKey && t && t.lineKey === lineKey && t.text === text && t.from !== wi) {
      const root = rootRef.current;
      const other = root?.querySelector<HTMLElement>(`[data-line="${CSS.escape(lineKey)}"][data-wi="${t.from}"]`);
      if (root && other) {
        const from = Math.min(t.from, wi);
        const to = Math.min(Math.max(t.from, wi), from + MAX_SELECTION_WORDS - 1);
        const pos = placeCard(root, unionRect(other.getBoundingClientRect(), e.currentTarget.getBoundingClientRect()), other);
        void ctl.openPhraseCard({ lineKey, text, from, to }, pos);
        return;
      }
    }
    drag.current = { lineKey, text, anchor: wi, current: wi, anchorEl: e.currentTarget, currentEl: e.currentTarget };
    setDragSel({ lineKey, text, from: wi, to: wi });
  };

  const onWordEnter = (e: MouseEvent<HTMLSpanElement>, lineKey: string, wi: number) => {
    const d = drag.current;
    if (!d || d.lineKey !== lineKey || Math.abs(wi - d.anchor) >= MAX_SELECTION_WORDS) return;
    d.current = wi;
    d.currentEl = e.currentTarget;
    setDragSel({ lineKey, text: d.text, from: Math.min(d.anchor, wi), to: Math.max(d.anchor, wi) });
  };

  const selected = (lineKey: string, text: string, wi: number): boolean => {
    if (dragSel) return dragSel.lineKey === lineKey && dragSel.text === text && wi >= dragSel.from && wi <= dragSel.to;
    const t = s.card?.target;
    return !!t && t.lineKey === lineKey && t.text === text && wi >= t.from && wi <= t.to;
  };

  const mode = captionMode(s);
  const lines =
    mode === 'file'
      ? s.activeCues.map((c) => ({ key: c.id, text: c.text }))
      : mode === 'youtube' && s.liveText
        ? s.liveText.split('\n').map((text, i) => ({ key: `live-${i}`, text }))
        : [];

  /**
   * Renders a caption line: every word is clickable (word card), draggable across words (phrase card)
   * and highlighted by status. Word indexes match lineWords() used for phrase lookups.
   */
  const words: WordRenderer = (text, lineKey) => {
    let wi = -1;
    return tokenize(text).map((t, i) => {
      if (!t.isWord) return <span key={i}>{t.text}</span>;
      const idx = ++wi;
      return (
        <span
          key={i}
          data-line={lineKey}
          data-wi={idx}
          className={`${wordClass(s.annotations[t.text], s.settings)}${selected(lineKey, text, idx) ? ' sel' : ''}`}
          onMouseDown={(e) => onWordDown(e, lineKey, text, idx)}
          onMouseEnter={(e) => onWordEnter(e, lineKey, idx)}
        >
          {t.text}
        </span>
      );
    });
  };

  return (
    <div
      className="root"
      ref={rootRef}
      style={{ '--card-alpha': String(s.settings.cardOpacity) } as CSSProperties}
      onMouseUp={() => {
        if (drag.current) finishDrag();
      }}
    >
      <Toolbar s={s} ctl={ctl} />
      {s.listOpen && mode === 'file' && s.cues && <CueList s={s} ctl={ctl} />}
      {s.listOpen && mode === 'youtube' && <TranscriptList s={s} ctl={ctl} words={words} />}
      {lines.length > 0 && (
        <div className="sub">
          <div className={`sub-box${mode === 'youtube' ? ' live' : ''}`}>
            {mode === 'youtube' && (
              <div className="src" title="读取 YouTube 正在显示的 CC 文字：只有当前这一句，没有完整时间轴，不支持按句精确回放">
                YouTube 字幕 · 尽力而为
              </div>
            )}
            {lines.map((line) => (
              <div key={line.key}>{words(line.text, line.key)}</div>
            ))}
          </div>
        </div>
      )}
      {s.card && <WordCard card={s.card} ctl={ctl} />}
      {s.message && (
        <div className={`msg ${s.message.kind}`}>
          <span>{s.message.text}</span>
          <button onMouseDown={noFocus} onClick={() => ctl.dismissMessage()}>
            关闭
          </button>
        </div>
      )}
      {s.reminder?.remind && (
        <div className="toast">
          <div>
            学习数据只保存在本机浏览器中{s.reminder.daysSinceExport !== null ? `，已 ${s.reminder.daysSinceExport} 天未导出备份` : ''}。
          </div>
          <div className="row">
            <button onMouseDown={noFocus} onClick={() => void ctl.backupNow()}>
              去备份
            </button>
            <button onMouseDown={noFocus} onClick={() => void ctl.dismissReminder(false)}>
              稍后
            </button>
            <button onMouseDown={noFocus} onClick={() => void ctl.dismissReminder(true)}>
              不再提示
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function menuHint(s: OverlayState): string {
  if (s.cues) return `当前字幕：导入的 ${s.fileName}（${s.cues.length} 条，时间准确）。`;
  if (!s.settings.youtubeCaptions) return '此视频尚未导入字幕。可以导入 SRT/VTT 文件，或开启“使用 YouTube 字幕”。';
  if (s.ccOn === false) return '请点击播放器右下角的 CC 按钮打开 YouTube 字幕，字幕中的单词就可以点击查词。';
  if (s.liveText) return '正在使用 YouTube 字幕（尽力而为）：只读取当前显示的文字，没有完整时间轴。';
  return '正在等待 YouTube 字幕。如果这个视频没有字幕，可以导入 SRT/VTT 文件。';
}

function Toolbar({ s, ctl }: { s: OverlayState; ctl: OverlayController }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="bar">
      <button className={`pill${s.menuOpen ? ' on' : ''}`} onMouseDown={noFocus} onClick={() => ctl.toggleMenu()} title="LinguaLens">
        LL{s.cues ? ` · ${s.cues.length}` : ''}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".srt,.vtt,text/vtt"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void ctl.importFile(f);
        }}
      />
      {s.menuOpen && (
        <div className="menu">
          <div className="hint">{menuHint(s)}</div>
          <button onMouseDown={noFocus} onClick={() => fileRef.current?.click()}>
            导入字幕文件…
          </button>
          <button onMouseDown={noFocus} onClick={() => void ctl.setYoutubeCaptions(!s.settings.youtubeCaptions)}>
            {s.settings.youtubeCaptions ? '✓ ' : ''}使用 YouTube 字幕（尽力而为）
          </button>
          {captionMode(s) === 'youtube' ? (
            <button onMouseDown={noFocus} disabled={s.transcript.length === 0} onClick={() => ctl.toggleList()}>
              {s.listOpen ? '隐藏字幕列表' : `已出现的字幕（${s.transcript.filter((i) => i.kind === 'line').length} 句，按顺序）`}
            </button>
          ) : (
            <button onMouseDown={noFocus} disabled={!s.cues} onClick={() => ctl.toggleList()}>
              {s.listOpen ? '隐藏字幕列表' : '字幕列表（点击跳转）'}
            </button>
          )}
          <button onMouseDown={noFocus} disabled={!s.cues} onClick={() => ctl.clearCues()}>
            清除字幕
          </button>
          <button onMouseDown={noFocus} onClick={() => void ctl.openOptions()}>
            生词本 / 备份 / 设置
          </button>
        </div>
      )}
    </div>
  );
}

function CueList({ s, ctl }: { s: OverlayState; ctl: OverlayController }) {
  const activeIds = new Set(s.activeCues.map((c) => c.id));
  const listRef = useRef<HTMLOListElement>(null);
  const firstActive = s.activeCues[0]?.id;
  useEffect(() => {
    if (!firstActive) return;
    const el = listRef.current?.querySelector('li.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [firstActive]);
  return (
    <div className="list">
      <header>
        <span>{s.fileName}</span>
        <button className="pill on" onMouseDown={noFocus} onClick={() => ctl.toggleList()}>
          关闭
        </button>
      </header>
      <ol ref={listRef}>
        {s.cues!.map((cue) => (
          <li key={cue.id} className={activeIds.has(cue.id) ? 'active' : ''} onMouseDown={noFocus} onClick={() => ctl.seekTo(cue)}>
            <span className="t">{formatTimestamp(cue.startMs)}</span>
            {cue.text.replace(/\n/g, ' ')}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Captions seen so far in "best effort" mode, in video order. No times and no jumping by design:
 * the order comes from the video time at which each line was first seen, which is only an estimate.
 */
function TranscriptList({ s, ctl, words }: { s: OverlayState; ctl: OverlayController; words: WordRenderer }) {
  const listRef = useRef<HTMLOListElement>(null);
  const visible = new Set((s.liveText ?? '').split('\n').filter(Boolean));
  const currentId = s.transcript.findLast((i) => i.kind === 'line' && visible.has(i.line.text));
  const currentKey = currentId?.kind === 'line' ? currentId.line.id : null;
  useEffect(() => {
    if (currentKey === null) return;
    listRef.current?.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
  }, [currentKey]);
  const count = s.transcript.filter((i) => i.kind === 'line').length;
  return (
    <div className="list">
      <header>
        <span title="只包含本次打开页面后播放过、并且打开了 CC 的部分；切换视频或刷新页面后清空">
          已出现的字幕 · {count} 句 · 尽力而为
        </span>
        <button className="pill on" onMouseDown={noFocus} onClick={() => ctl.toggleList()}>
          关闭
        </button>
      </header>
      <ol ref={listRef}>
        {s.transcript.length === 0 && <li className="gap">还没有记录到字幕。打开 CC 并播放后，出现过的字幕会按顺序列在这里。</li>}
        {s.transcript.map((item) =>
          item.kind === 'gap' ? (
            <li key={item.key} className="gap">
              …… 中间有一段没有播放过 ……
            </li>
          ) : (
            <li key={item.line.id} className={`tl${item.line.id === currentKey ? ' active' : ''}`}>
              {words(item.line.text, `t-${item.line.id}`)}
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

