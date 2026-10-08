import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendLl } from '../../src/storage/client';
import type { ImportResult, KvRecord, LlRequest, LlResponse } from '../../src/storage/protocol';
import { LAST_EXPORT_KEY } from '../../src/storage/router';
import type { BackupFile } from '../../src/vocab/backup';
import { STATUS_LABEL, VOCAB_STATUSES, type CustomDefinition, type Settings, type VocabRecord, type VocabStatus } from '../../src/vocab/types';

const call = <T,>(msg: LlRequest): Promise<LlResponse<T>> => sendLl<T>((m) => browser.runtime.sendMessage(m), msg);
const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleString() : '从未');
const PAGE = 300;

function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `lingualens-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export function App() {
  const [vocab, setVocab] = useState<VocabRecord[]>([]);
  const [defs, setDefs] = useState<Map<string, CustomDefinition>>(new Map());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lastExport, setLastExport] = useState<number | null>(null);
  const [filter, setFilter] = useState<VocabStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [v, d, s, e] = await Promise.all([
      call<VocabRecord[]>({ type: 'll/vocab-list' }),
      call<CustomDefinition[]>({ type: 'll/custom-def-list' }),
      call<Settings>({ type: 'll/settings-get' }),
      call<KvRecord | null>({ type: 'll/kv-get', key: LAST_EXPORT_KEY }),
    ]);
    if (v.ok) setVocab(v.data);
    if (d.ok) setDefs(new Map(d.data.map((x) => [x.lemma, x])));
    if (s.ok) setSettings(s.data);
    if (e.ok) setLastExport(typeof e.data?.value === 'number' ? e.data.value : null);
    const failed = [v, d, s, e].find((r) => !r.ok);
    if (failed && !failed.ok) setNotice({ kind: 'err', text: `读取失败：${failed.error}` });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const counts = useMemo(() => {
    const c: Record<VocabStatus, number> = { known: 0, learning: 0, unknown: 0 };
    for (const v of vocab) c[v.status]++;
    return c;
  }, [vocab]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vocab
      .filter((v) => (filter === 'all' || v.status === filter) && (!q || v.lemma.includes(q) || v.lastWord?.includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [vocab, filter, query]);

  const changeStatus = async (lemma: string, status: VocabStatus | null) => {
    const res = await call<VocabRecord | null>({ type: 'll/vocab-set', lemma, status });
    if (!res.ok) return setNotice({ kind: 'err', text: `保存失败：${res.error}` });
    setVocab((list) => (status === null ? list.filter((v) => v.lemma !== lemma) : list.map((v) => (v.lemma === lemma && res.data ? res.data : v))));
  };

  const doExport = async () => {
    const res = await call<BackupFile>({ type: 'll/export' });
    if (!res.ok) return setNotice({ kind: 'err', text: `导出失败：${res.error}` });
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setLastExport(Date.parse(res.data.exportedAt));
    setNotice({
      kind: 'ok',
      text: `已导出 ${res.data.vocab.length} 个词、${res.data.customDefinitions.length} 条自定义释义（schemaVersion ${res.data.schemaVersion}）。`,
    });
  };

  const doImport = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setNotice({ kind: 'err', text: `导入失败：${file.name} 不是有效的 JSON 文件` });
    }
    const res = await call<ImportResult>({ type: 'll/import', data });
    if (!res.ok) return setNotice({ kind: 'err', text: `导入失败：${res.error}` });
    const r = res.data;
    setNotice({
      kind: 'ok',
      text:
        `导入完成。生词：新增 ${r.vocab.added}，更新 ${r.vocab.updated}，保持不变 ${r.vocab.unchanged}；` +
        `自定义释义：新增 ${r.customDefinitions.added}，更新 ${r.customDefinitions.updated}` +
        `${r.skipped.length ? `；跳过 ${r.skipped.length} 条格式错误的记录` : ''}${r.settingsImported ? '；设置已恢复' : ''}。`,
    });
    await reload();
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    const res = await call<Settings>({ type: 'll/settings-set', settings: patch });
    if (res.ok) setSettings(res.data);
    else setNotice({ kind: 'err', text: `设置保存失败：${res.error}` });
  };

  const licenseUrl = (browser.runtime.getURL as (p: string) => string)('/dict/LICENSE-ECDICT.txt');

  return (
    <main>
      <h1>LinguaLens</h1>
      {notice && (
        <p className={`notice ${notice.kind}`}>
          {notice.text} <button onClick={() => setNotice(null)}>关闭</button>
        </p>
      )}

      <section>
        <h2>备份</h2>
        <p className="muted">
          学习数据只保存在本机 Chrome 的扩展数据库中，不在项目目录里，也不会被 GitHub 或任何云服务备份。卸载扩展或清除浏览器数据会删除它。请定期导出。
        </p>
        <p>上次导出：{fmtDate(lastExport)}</p>
        <div className="row">
          <button onClick={() => void doExport()}>导出 JSON 备份</button>
          <label className="file">
            从 JSON 导入…
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (f) void doImport(f);
              }}
            />
          </label>
        </div>
        <p className="muted small">导入时按“最后修改时间”合并：同一个词以较新的记录为准，不会删除本机已有而备份中没有的词。</p>
      </section>

      <section>
        <h2>生词本</h2>
        <div className="row">
          {(['all', ...VOCAB_STATUSES] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? `全部 ${vocab.length}` : `${STATUS_LABEL[f]} ${counts[f]}`}
            </button>
          ))}
          <input className="search" placeholder="搜索词元" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {shown.length === 0 ? (
          <p className="muted">还没有记录。在 YouTube 导入字幕后，点击字幕中的单词即可标记。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>词元</th>
                <th>最近遇到的词形</th>
                <th>状态</th>
                <th>我的释义</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, PAGE).map((v) => (
                <tr key={v.lemma}>
                  <td className="lemma">{v.lemma}</td>
                  <td>{v.lastWord && v.lastWord !== v.lemma ? v.lastWord : ''}</td>
                  <td>
                    <select value={v.status} onChange={(e) => void changeStatus(v.lemma, e.target.value as VocabStatus)}>
                      {VOCAB_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>{' '}
                    <button className="small" onClick={() => void changeStatus(v.lemma, null)}>
                      删除
                    </button>
                  </td>
                  <td className="def">{defs.get(v.lemma)?.text ?? ''}</td>
                  <td className="muted small">{fmtDate(v.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shown.length > PAGE && <p className="muted small">只显示最近更新的 {PAGE} 条，请用搜索查找其他词。</p>}
      </section>

      {settings && (
        <section>
          <h2>设置</h2>
          <label className="check">
            <input type="checkbox" checked={settings.pauseOnLookup} onChange={(e) => void saveSettings({ pauseOnLookup: e.target.checked })} />
            查词时暂停视频（关闭词卡后自动继续）
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.highlightRare} onChange={(e) => void saveSettings({ highlightRare: e.target.checked })} />
            用虚线标出未标记的低频词：词频排名高于
            <input
              type="number"
              min={100}
              step={500}
              value={settings.rareRankThreshold}
              onChange={(e) => void saveSettings({ rareRankThreshold: Number(e.target.value) })}
            />
            的词（粗略判断，依据 ECDICT 公开词频）
          </label>
          <label className="check">
            备份提醒：超过
            <input
              type="number"
              min={0}
              value={settings.backupReminderDays}
              onChange={(e) => void saveSettings({ backupReminderDays: Number(e.target.value) })}
            />
            天未导出时提醒一次（0 表示关闭）
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.showDiagnostics} onChange={(e) => void saveSettings({ showDiagnostics: e.target.checked })} />
            显示诊断面板（开发用，刷新 YouTube 页面后生效）
          </label>
        </section>
      )}

      <section>
        <h2>关于与隐私</h2>
        <ul className="muted">
          <li>
            词典数据：ECDICT（MIT License，Copyright (c) 2025 Linwei），已裁剪为常用词。<a href={licenseUrl} target="_blank" rel="noreferrer">许可证全文</a>
          </li>
          <li>不读取 Cookie 或账号信息，不上传观看历史，不接入任何云服务或付费 API。</li>
          <li>只在 www.youtube.com 观看页运行；字幕来自你导入的 SRT/VTT 文件。</li>
        </ul>
      </section>
    </main>
  );
}
