import { useSyncExternalStore, type CSSProperties } from 'react';
import { WordCard } from '../content/ui/WordCard';
import type { WebLookup } from './web-lookup';

export function WebApp({ web }: { web: WebLookup }) {
  const s = useSyncExternalStore(web.store.subscribe, web.store.get);
  // Machine translation actions only when the setting is on.
  const ctl = s.settings.webTranslate ? web.actions : web.cards;
  return (
    <div className="root" style={{ '--card-alpha': String(s.settings.cardOpacity) } as CSSProperties}>
      {s.card && <WordCard card={s.card} ctl={ctl} />}
      {s.offer && (
        <button
          className="offer"
          style={{ left: s.offer.x, top: s.offer.y }}
          title="机器翻译选中的文字（本机）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => web.translateOffer()}
        >
          译
        </button>
      )}
      {s.notice && (
        <div className="notice">
          <span>{s.notice}</span>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => web.dismissNotice()}>
            知道了
          </button>
        </div>
      )}
    </div>
  );
}
