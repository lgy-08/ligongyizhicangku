import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { formatTimestamp } from '../../captions/text';
import { tokenize } from '../../dict/tokenize';
import { STATUS_LABEL, VOCAB_STATUSES, type VocabStatus } from '../../vocab/types';
import type { OverlayController } from '../overlay-controller';
import { captionMode, wordClass, type CardState, type OverlayState } from '../overlay-state';

const CARD_WIDTH = 330;
type WordRenderer = (text: string) => ReactNode;
/** Prevents buttons from taking focus, so Space / K / F keep controlling the YouTube player. */
const noFocus = (e: MouseEvent) => e.preventDefault();

export function App({ ctl }: { ctl: OverlayController }) {
  const s = useSyncExternalStore(ctl.store.subscribe, ctl.store.get);
  const rootRef = useRef<HTMLDivElement>(null);

  const onWordClick = (e: MouseEvent<HTMLSpanElement>, word: string) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const w = e.currentTarget.getBoundingClientRect();
    const center = w.left + w.width / 2 - r.left;
    const x = Math.max(8, Math.min(center - CARD_WIDTH / 2, r.width - CARD_WIDTH - 8));
    // Words in the upper half (e.g. in the list) open the card below them, otherwise above.
    if (w.top - r.top < r.height / 2) void ctl.openCard(word, x, null, w.bottom - r.top + 8);
    else void ctl.openCard(word, x, r.bottom - w.top + 8);
  };

  const mode = captionMode(s);
  const lines =
    mode === 'file'
      ? s.activeCues.map((c) => ({ key: c.id, text: c.text }))
      : mode === 'youtube' && s.liveText
        ? s.liveText.split('\n').map((text, i) => ({ key: `live-${i}`, text }))
        : [];

  /** Renders a caption line with every word clickable (lookup) and highlighted by status. */
  const words: WordRenderer = (text) =>
    tokenize(text).map((t, i) =>
      t.isWord ? (
        <span
          key={i}
          className={`${wordClass(s.annotations[t.text], s.settings)}${s.card?.word === t.text ? ' sel' : ''}`}
          onMouseDown={noFocus}
          onClick={(e) => {
            e.stopPropagation();
            onWordClick(e, t.text);
          }}
        >
          {t.text}
        </span>
      ) : (
        <span key={i}>{t.text}</span>
      ),
    );

  return (
    <div className="root" ref={rootRef}>
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
              <div key={line.key}>{words(line.text)}</div>
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
              {words(item.line.text)}
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

function WordCard({ card, ctl }: { card: CardState; ctl: OverlayController }) {
  const r = card.result;
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (card.editing) setDraft(r?.custom?.text ?? '');
  }, [card.editing, r?.custom?.text]);

  const status = r?.vocab?.status ?? null;
  const entry = r?.lemmaEntry ?? null;
  const hasAnyDefinition = !!(entry || r?.wordEntry || r?.custom);

  return (
    <div
      className="card"
      style={card.top !== null ? { left: card.x, top: card.top } : { left: card.x, bottom: card.bottom ?? 0 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') ctl.closeCard();
      }}
    >
      <div className="head">
        <span className="word">{card.word}</span>
        {r && r.lemma !== r.word && <span className="lemma">→ {r.lemma}</span>}
        {entry?.phonetic && <span className="ph">/{entry.phonetic}/</span>}
        <button className="x" onMouseDown={noFocus} onClick={() => ctl.closeCard()} title="关闭">
          ×
        </button>
      </div>

      {card.loading && <div className="meta">查询中…</div>}

      {r && (
        <>
          {entry && entry.tags.length > 0 && (
            <div className="tags">
              {entry.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          )}
          {entry && <div className="def">{entry.translation}</div>}
          {r.wordEntry && (
            <div className="def sub-def">
              「{r.word}」本身：{r.wordEntry.translation}
            </div>
          )}
          {!hasAnyDefinition && (
            <div className="none">
              暂无释义。{r.dictAvailable ? '本地词典中没有这个词，' : `${r.dictError ?? '词典未加载。'}`}你可以手动添加。
            </div>
          )}
          {r.custom && !card.editing && (
            <div className="custom">
              <small>我的释义</small>
              {r.custom.text}
            </div>
          )}
          {card.editing ? (
            <div>
              <textarea
                autoFocus
                value={draft}
                maxLength={2000}
                placeholder={`为 ${r.lemma} 写一条释义（留空保存即删除）`}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="row">
                <button className="btn" disabled={card.saving} onClick={() => void ctl.saveCustomDef(draft)}>
                  保存
                </button>
                <button className="btn" onClick={() => ctl.setEditing(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button className="link" onMouseDown={noFocus} onClick={() => ctl.setEditing(true)}>
              {r.custom ? '编辑我的释义' : '添加我的释义'}
            </button>
          )}

          <div className="row">
            {VOCAB_STATUSES.map((st: VocabStatus) => (
              <button
                key={st}
                className={`btn ${st}${status === st ? ' on' : ''}`}
                disabled={card.saving}
                onMouseDown={noFocus}
                onClick={() => void ctl.setStatus(st)}
              >
                {STATUS_LABEL[st]}
              </button>
            ))}
            {status && (
              <button className="link" disabled={card.saving} onMouseDown={noFocus} onClick={() => void ctl.setStatus(null)}>
                清除标记
              </button>
            )}
          </div>
          <div className="meta">
            按词元「{r.lemma}」记录
            {r.method === 'rule' ? '（规则推断）' : r.method === 'none' ? '（词典未收录，按原词）' : ''}
          </div>
        </>
      )}
      {card.error && <div className="err">{card.error}</div>}
    </div>
  );
}
