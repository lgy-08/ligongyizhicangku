import { CueIndex, parseCaptionFile, type CaptionCue } from '../captions';
import { uniqueWords } from '../dict/tokenize';
import type { Annotation, LlRequest, LlResponse, LookupResult, ReminderResult } from '../storage/protocol';
import type { CustomDefinition, Settings, VocabRecord, VocabStatus } from '../vocab/types';
import type { PlayerEventType, PlayerSession } from '../youtube/player-session';
import { CueSync } from './cue-sync';
import { LiveCaptions } from './live-captions';
import { applyStatus, captionMode, initialOverlayState, type OverlayState } from './overlay-state';
import { createStore, type Store } from './store';

export type CallFn = <T>(msg: LlRequest) => Promise<LlResponse<T>>;

const ANNOTATE_CHUNK = 5000;

/**
 * Non-visual logic of the in-player overlay. One instance per content-script lifetime;
 * attachSession/detachSession are called by WatchController on every video change.
 */
export class OverlayController {
  readonly store: Store<OverlayState> = createStore(initialOverlayState());
  private session: PlayerSession | null = null;
  private sync: CueSync | null = null;
  private pausedByUs = false;
  private reminderChecked = false;
  /** Incremented on every session change; async results from an older session are dropped. */
  private epoch = 0;

  constructor(private readonly call: CallFn) {}

  get settings(): Settings {
    return this.store.get().settings;
  }

  async loadSettings(): Promise<void> {
    const res = await this.call<Settings>({ type: 'll/settings-get' });
    if (res.ok) this.store.set({ settings: res.data });
    this.applyNativeHidden();
  }

  /**
   * @param playerEl YouTube's #movie_player; enables the "best effort" YouTube-caption source.
   */
  attachSession(session: PlayerSession, videoId: string, playerEl?: Element): void {
    this.detachSession();
    this.epoch++;
    this.session = session;
    this.sync = new CueSync({
      getTimeMs: () => session.snapshot().currentTimeMs,
      onChange: (active) => this.store.set({ activeCues: active }),
    });
    this.store.set({ ...initialOverlayState(), settings: this.settings, videoId });
    if (!session.video.paused) this.sync.play();
    if (playerEl) {
      this.live = new LiveCaptions({
        root: playerEl,
        onChange: (text, ccOn) => {
          this.store.set({ liveText: text, ccOn });
          if (text && captionMode(this.store.get()) === 'youtube') void this.annotateLive(text);
        },
      });
      this.live.start();
      this.applyNativeHidden();
    }
    void this.checkReminder();
  }

  /** Clears everything tied to the current video: no subtitle residue across videos. */
  detachSession(): void {
    this.epoch++;
    this.sync?.dispose();
    this.sync = null;
    this.live?.dispose(); // also restores YouTube's own caption box
    this.live = null;
    this.pendingWords.clear();
    this.session = null;
    this.pausedByUs = false;
    this.store.set({ ...initialOverlayState(), settings: this.settings, reminder: this.store.get().reminder });
  }

  // ---------- YouTube on-screen captions ("best effort") ----------

  private live: LiveCaptions | null = null;
  private readonly pendingWords = new Set<string>();

  /** YouTube's caption box is hidden only while our overlay shows that same text. */
  private applyNativeHidden(): void {
    this.live?.setNativeHidden(captionMode(this.store.get()) === 'youtube');
  }

  async setYoutubeCaptions(enabled: boolean): Promise<void> {
    this.store.set((s) => ({ settings: { ...s.settings, youtubeCaptions: enabled }, menuOpen: false }));
    this.applyNativeHidden();
    const text = this.store.get().liveText;
    if (enabled && text) void this.annotateLive(text);
    const res = await this.call<Settings>({ type: 'll/settings-set', settings: { youtubeCaptions: enabled } });
    if (!res.ok) this.store.set({ message: { kind: 'error', text: `设置保存失败：${res.error}` } });
  }

  /** Annotates only words not seen before in this session; concurrent duplicates are skipped. */
  private async annotateLive(text: string): Promise<void> {
    const known = this.store.get().annotations;
    const words = uniqueWords([text]).filter((w) => !(w in known) && !this.pendingWords.has(w));
    if (words.length === 0) return;
    for (const w of words) this.pendingWords.add(w);
    const epoch = this.epoch;
    const res = await this.call<Record<string, Annotation>>({ type: 'll/annotate', words });
    if (epoch !== this.epoch) return;
    for (const w of words) this.pendingWords.delete(w);
    if (res.ok) this.store.set((s) => ({ annotations: { ...s.annotations, ...res.data } }));
  }

  onPlayerEvent(type: PlayerEventType): void {
    const sync = this.sync;
    if (!sync) return;
    switch (type) {
      case 'play':
      case 'playing':
        sync.play();
        if (this.store.get().card && this.pausedByUs) this.pausedByUs = false; // user resumed manually
        break;
      case 'pause':
      case 'ended':
      case 'emptied':
        sync.stop();
        break;
      default:
        sync.update(); // seeked, timeupdate (fallback when rAF is throttled), etc.
    }
  }

  // ---------- subtitles ----------

  async importFile(file: File): Promise<void> {
    const epoch = this.epoch;
    let cues: CaptionCue[];
    let warnings: string[];
    try {
      const res = parseCaptionFile(await file.text(), file.name);
      cues = res.cues;
      warnings = res.warnings;
    } catch (err) {
      this.store.set({ message: { kind: 'error', text: `导入失败：${err instanceof Error ? err.message : String(err)}` } });
      return;
    }
    if (epoch !== this.epoch || !this.sync) return;
    const index = new CueIndex(cues);
    this.store.set({
      cues: [...index.cues],
      fileName: file.name,
      annotations: {},
      menuOpen: false,
      message: {
        kind: 'info',
        text: `已导入 ${file.name}：${cues.length} 条字幕${warnings.length ? `，跳过 ${warnings.length} 处异常` : ''}`,
      },
    });
    this.sync.setIndex(index);
    this.applyNativeHidden(); // file mode: give YouTube its own caption box back
    await this.annotate(cues, epoch);
  }

  clearCues(): void {
    this.sync?.setIndex(null);
    this.store.set({ cues: null, fileName: null, activeCues: [], annotations: {}, card: null, menuOpen: false, listOpen: false, message: null });
    this.applyNativeHidden();
    const text = this.store.get().liveText;
    if (text && captionMode(this.store.get()) === 'youtube') void this.annotateLive(text);
  }

  private async annotate(cues: readonly CaptionCue[], epoch: number): Promise<void> {
    const words = uniqueWords(cues.map((c) => c.text));
    for (let i = 0; i < words.length; i += ANNOTATE_CHUNK) {
      const res = await this.call<Record<string, Annotation>>({ type: 'll/annotate', words: words.slice(i, i + ANNOTATE_CHUNK) });
      if (epoch !== this.epoch) return;
      if (!res.ok) {
        this.store.set({ message: { kind: 'error', text: `生词标注失败：${res.error}` } });
        return;
      }
      this.store.set((s) => ({ annotations: { ...s.annotations, ...res.data } }));
    }
  }

  seekTo(cue: CaptionCue): void {
    this.session?.seekTo(cue.startMs);
    this.sync?.update();
  }

  // ---------- word card ----------

  async openCard(word: string, x: number, bottom: number): Promise<void> {
    const epoch = this.epoch;
    this.store.set({
      card: { word, x, bottom, loading: true, result: null, error: null, editing: false, saving: false },
      menuOpen: false,
    });
    const video = this.session?.video;
    if (this.settings.pauseOnLookup && video && !video.paused) {
      video.pause();
      this.pausedByUs = true;
    }
    const res = await this.call<LookupResult>({ type: 'll/lookup', word });
    const card = this.store.get().card;
    if (epoch !== this.epoch || !card || card.word !== word) return; // stale
    this.store.set({
      card: res.ok ? { ...card, loading: false, result: res.data } : { ...card, loading: false, error: res.error },
    });
  }

  closeCard(): void {
    if (!this.store.get().card) return;
    this.store.set({ card: null });
    const video = this.session?.video;
    if (this.pausedByUs && video?.paused) void video.play().catch(() => {});
    this.pausedByUs = false;
  }

  async setStatus(status: VocabStatus | null): Promise<void> {
    const card = this.store.get().card;
    const r = card?.result;
    if (!card || !r) return;
    this.store.set({ card: { ...card, saving: true } });
    const res = await this.call<VocabRecord | null>({ type: 'll/vocab-set', lemma: r.lemma, status, word: r.word });
    const now = this.store.get().card;
    if (!now || now.word !== card.word) return;
    if (!res.ok) {
      this.store.set({ card: { ...now, saving: false, error: res.error } });
      return;
    }
    this.store.set((s) => ({
      card: { ...now, saving: false, error: null, result: { ...r, vocab: res.data } },
      annotations: applyStatus(s.annotations, r.lemma, status),
    }));
  }

  setEditing(editing: boolean): void {
    const card = this.store.get().card;
    if (card) this.store.set({ card: { ...card, editing } });
  }

  async saveCustomDef(text: string): Promise<void> {
    const card = this.store.get().card;
    const r = card?.result;
    if (!card || !r) return;
    this.store.set({ card: { ...card, saving: true } });
    const res = await this.call<CustomDefinition | null>({ type: 'll/custom-def-set', lemma: r.lemma, text });
    const now = this.store.get().card;
    if (!now || now.word !== card.word) return;
    this.store.set({
      card: res.ok
        ? { ...now, saving: false, editing: false, error: null, result: { ...r, custom: res.data } }
        : { ...now, saving: false, error: res.error },
    });
  }

  // ---------- chrome ----------

  toggleMenu(): void {
    this.store.set((s) => ({ menuOpen: !s.menuOpen }));
  }

  toggleList(): void {
    this.store.set((s) => ({ listOpen: !s.listOpen, menuOpen: false }));
  }

  dismissMessage(): void {
    this.store.set({ message: null });
  }

  async openOptions(): Promise<void> {
    this.store.set({ menuOpen: false });
    const res = await this.call({ type: 'll/open-options' });
    if (!res.ok) this.store.set({ message: { kind: 'error', text: `无法打开设置页：${res.error}` } });
  }

  private async checkReminder(): Promise<void> {
    if (this.reminderChecked) return; // at most once per page load
    this.reminderChecked = true;
    const res = await this.call<ReminderResult>({ type: 'll/reminder-check' });
    if (res.ok && res.data.remind) this.store.set({ reminder: res.data });
  }

  async dismissReminder(disable: boolean): Promise<void> {
    this.store.set({ reminder: null });
    await this.call({ type: 'll/reminder-dismiss', disable });
  }

  async backupNow(): Promise<void> {
    this.store.set({ reminder: null });
    await this.openOptions();
  }

  dispose(): void {
    this.detachSession();
  }
}
