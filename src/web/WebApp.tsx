import { useSyncExternalStore, type CSSProperties } from 'react';
import { WordCard } from '../content/ui/WordCard';
import type { WebLookup } from './web-lookup';

export function WebApp({ web }: { web: WebLookup }) {
  const s = useSyncExternalStore(web.store.subscribe, web.store.get);
  return (
    <div className="root" style={{ '--card-alpha': String(s.settings.cardOpacity) } as CSSProperties}>
      {s.card && <WordCard card={s.card} ctl={web.cards} />}
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
