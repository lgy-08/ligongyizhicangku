import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import type { PhraseEntry } from '../../storage/protocol';
import { STATUS_LABEL, VOCAB_STATUSES, type VocabStatus } from '../../vocab/types';
import type { CardActions } from '../card-controller';
import type { CardState } from '../overlay-state';

/** Prevents buttons from taking focus, so keyboard shortcuts of the page/player keep working. */
const noFocus = (e: MouseEvent) => e.preventDefault();

/**
 * Machine translation block (web pages). Always labelled so it is never mistaken for a dictionary
 * definition; the sentence translation is shown as context below it.
 */
export function MtSection({ mt }: { mt: NonNullable<CardState['mt']> }) {
  return (
    <div className="mt">
      <small title={mt.channel ? `翻译通道：${mt.channel === 'direct' ? '直接调用' : mt.channel === 'bridge' ? '页面桥接' : mt.channel}` : undefined}>
        机器翻译 · 本机
      </small>
      {mt.status === 'loading' && <div className="meta">翻译中…</div>}
      {mt.status === 'downloading' && (
        <div className="meta">正在下载翻译语言包（仅首次）… {mt.progress !== undefined ? `${Math.round(mt.progress * 100)}%` : ''}</div>
      )}
      {mt.status === 'error' && <div className="err">{mt.error}</div>}
      {mt.status === 'done' && <div className="mt-text">{mt.text}</div>}
      {mt.sentence && (
        <div className="mt-sentence" title={mt.sentence.source}>
          <small>所在整句</small>
          {mt.sentence.status === 'loading' && <span className="meta">翻译中…</span>}
          {mt.sentence.status === 'error' && <span className="meta">整句翻译失败</span>}
          {mt.sentence.status === 'done' && <span>{mt.sentence.text}</span>}
        </div>
      )}
    </div>
  );
}

/** Word / phrase card shared by the YouTube overlay and web-page lookup. Styles: card.css. */
/** Compact phrase list: phrase in bold, first two lines of its dictionary translation. */
export function PhraseList({ items }: { items: readonly PhraseEntry[] }) {
  return (
    <ul className="phrases">
      {items.map((p) => (
        <li key={p.phrase}>
          <b>{p.phrase}</b>
          <span>{p.entry.translation.split('\n').slice(0, 2).join('；')}</span>
        </li>
      ))}
    </ul>
  );
}

export function WordCard({ card, ctl }: { card: CardState; ctl: CardActions }) {
  const r = card.result;
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (card.editing) setDraft(r?.custom?.text ?? '');
  }, [card.editing, r?.custom?.text]);

  const status = r?.vocab?.status ?? null;
  const entry = r?.lemmaEntry ?? null;
  const hasAnyDefinition = !!(entry || r?.wordEntry || r?.custom);

  const style: CSSProperties = {
    left: card.x,
    ...(card.top !== null ? { top: card.top } : { bottom: card.bottom ?? 0 }),
    ...(card.maxHeight !== null ? { maxHeight: card.maxHeight } : {}),
  };

  const close = (
    <button className="x" onMouseDown={noFocus} onClick={() => ctl.closeCard()} title="关闭">
      ×
    </button>
  );

  if (card.kind === 'text') {
    const preview = card.word.length > 120 ? `${card.word.slice(0, 120)}…` : card.word;
    return (
      <div className="card text-card" style={style}>
        <div className="head">
          <span className="source" title={card.word}>
            {preview}
          </span>
          {close}
        </div>
        {card.mt && <MtSection mt={card.mt} />}
        <div className="meta">机器翻译由 Chrome 在本机完成，仅供参考</div>
      </div>
    );
  }

  if (card.kind === 'phrase') {
    const p = card.phrase;
    return (
      <div className="card" style={style}>
        <div className="head">
          <span className="word phrase">{card.word}</span>
          {p?.match && p.match.phrase !== card.word.toLowerCase() && <span className="lemma">→ {p.match.phrase}</span>}
          {close}
        </div>
        {card.loading && <div className="meta">查询中…</div>}
        {p?.match && (
          <>
            <small className="src-label">词典</small>
            <div className="def">{p.match.entry.translation}</div>
          </>
        )}
        {p && !p.match && (
          <div className="none">
            {p.dictAvailable ? `短语词典中没有「${p.selection}」。` : (p.dictError ?? '词典未加载。')}
            {p.inner.length > 0 ? '其中包含以下短语：' : card.mt ? '' : '可以分别点击单词查看释义。'}
          </div>
        )}
        {p && !p.match && <PhraseList items={p.inner} />}
        {card.mt && <MtSection mt={card.mt} />}
        {p && (
          <div className="meta">
            短语释义来自 ECDICT 词典{card.mt ? ' · 机器翻译由 Chrome 在本机完成，仅供参考' : ''} · 短语暂不能加入生词本
          </div>
        )}
        {card.error && <div className="err">{card.error}</div>}
      </div>
    );
  }

  return (
    <div
      className="card"
      style={style}
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

      {r && r.phrases.length > 0 && (
        <div className="in-phrase">
          <small>所在短语</small>
          <PhraseList items={r.phrases} />
        </div>
      )}

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
              暂无释义。{r.dictAvailable ? '本地词典中没有这个词，' : `${r.dictError ?? '词典未加载。'}`}你可以手动添加
              {ctl.machineTranslate ? '，或试试机器翻译' : ''}。
            </div>
          )}
          {!hasAnyDefinition && ctl.machineTranslate && !card.mt && (
            <button className="btn" onMouseDown={noFocus} onClick={() => ctl.machineTranslate?.()}>
              机器翻译试试
            </button>
          )}
          {card.mt && <MtSection mt={card.mt} />}
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
