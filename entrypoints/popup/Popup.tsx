import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { classifyPage, type PageKind } from '../../src/web/page-kind';

type State = { kind: 'loading' } | { kind: PageKind } | { kind: 'on' } | { kind: 'off' } | { kind: 'error'; message: string };

const SCRIPT = '/web-lookup.js';

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Runs in the page's isolated world, same as the injected script, so it sees the same global. */
function isActiveInPage(): boolean {
  return Boolean((globalThis as { __llWebLookup?: unknown }).__llWebLookup);
}
function disposeInPage(): void {
  (globalThis as { __llWebLookup?: { dispose(): void } }).__llWebLookup?.dispose();
}

export function Popup() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const tab = await activeTab();
      if (!tab?.id) return setState({ kind: 'unsupported' });
      setTabId(tab.id);
      const kind = classifyPage(tab.url);
      if (kind !== 'web') return setState({ kind });
      try {
        const [r] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: isActiveInPage });
        setState({ kind: r?.result ? 'on' : 'off' });
      } catch {
        setState({ kind: 'unsupported' });
      }
    })();
  }, []);

  const enable = async () => {
    if (tabId === null) return;
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: [SCRIPT] as never });
      await browser.action.setBadgeBackgroundColor({ tabId, color: '#2f6fdb' });
      await browser.action.setBadgeText({ tabId, text: 'ON' });
      window.close();
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const disable = async () => {
    if (tabId === null) return;
    try {
      await browser.scripting.executeScript({ target: { tabId }, func: disposeInPage });
      await browser.action.setBadgeText({ tabId, text: '' });
      setState({ kind: 'off' });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <main>
      <h1>LinguaLens</h1>
      {state.kind === 'loading' && <p className="muted">正在检查当前页面…</p>}
      {state.kind === 'off' && (
        <>
          <button className="primary" onClick={() => void enable()}>
            在本页启用查词
          </button>
          <p className="muted small">启用后：双击英文单词查释义，选中 2–12 个词查短语。只对当前页面生效，刷新或跳转后需重新启用。</p>
        </>
      )}
      {state.kind === 'on' && (
        <>
          <p className="ok">本页查词已启用。</p>
          <button onClick={() => void disable()}>在本页停用查词</button>
        </>
      )}
      {state.kind === 'youtube' && <p className="muted">YouTube 页面由扩展自动支持：打开 CC 或导入字幕后，点击字幕中的单词即可查词。</p>}
      {state.kind === 'unsupported' && (
        <p className="muted">
          这个页面不支持查词（例如浏览器设置页、扩展商店、PDF 或本地文件）。本地文件需要在扩展详情中打开“允许访问文件网址”。
        </p>
      )}
      {state.kind === 'error' && <p className="err">启用失败：{state.message}</p>}
      <hr />
      <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
        打开生词本与设置
      </button>
    </main>
  );
}
