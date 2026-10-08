import { el } from './dom';

/**
 * Minimal caption overlay placed inside YouTube's player container.
 * pointer-events: none, so clicks still reach the player (play/pause, controls).
 */
export class CaptionLayer {
  private readonly node: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly tagEl: HTMLDivElement;

  constructor() {
    this.node = el('div');
    this.node.setAttribute('data-lingualens', 'll001-caption-layer');
    Object.assign(this.node.style, {
      position: 'absolute',
      left: '50%',
      top: '8%',
      transform: 'translateX(-50%)',
      maxWidth: '80%',
      zIndex: '60',
      pointerEvents: 'none',
      display: 'none',
      textAlign: 'center',
      font: '600 20px/1.35 system-ui, sans-serif',
      color: '#fff',
      background: 'rgba(0,0,0,.65)',
      padding: '4px 10px',
      borderRadius: '6px',
      whiteSpace: 'pre-line',
    } satisfies Partial<CSSStyleDeclaration>);
    this.tagEl = el('div');
    Object.assign(this.tagEl.style, { font: '10px system-ui, sans-serif', color: '#9cf', opacity: '.85' });
    this.textEl = el('div');
    this.node.append(this.tagEl, this.textEl);
  }

  attach(container: Element): void {
    if (this.node.parentElement !== container) container.append(this.node);
  }

  show(text: string, tag: string): void {
    this.textEl.textContent = text;
    this.tagEl.textContent = tag;
    this.node.style.display = '';
  }

  hide(): void {
    this.node.style.display = 'none';
    this.textEl.textContent = '';
  }

  detach(): void {
    this.hide();
    this.node.remove();
  }
}
