# LinguaLens 架构（LL-002）

## 1. 运行环境与边界

```
┌──────────────── www.youtube.com/watch 页面 ────────────────┐
│ MAIN world: youtube-probe.js  只读字幕轨道元数据（诊断用）    │
│ 隔离环境:   youtube.js                                       │
│   WatchController ─ PlayerSession(<video> 被动监听)          │
│   OverlayController ─ CueSync(rAF) ─ React 叠加层(shadow DOM)│
│   诊断面板（设置中开启）                                     │
└───────────────┬─────────────────────────────────────────────┘
                │ chrome.runtime.sendMessage（ll/* 协议）
┌───────────────▼──── background service worker ──────────────┐
│ router.handleRequest ─ IndexedDB(lingualens v2)              │
│                      ─ Dictionary（按需 fetch 打包的 JSON）  │
└───────────────▲─────────────────────────────────────────────┘
                │ 同一消息协议
┌───────────────┴──── options.html（React）────────────────────┐
│ 生词本、导出/导入、设置、许可证与隐私说明                     │
└──────────────────────────────────────────────────────────────┘
```

硬性约束及其落实方式：

| 约束 | 落实 |
|---|---|
| IndexedDB 只在 background | 只有 `entrypoints/background.ts` 创建 `createIdbStore()`；content 和 options 都只发消息 |
| SPA 导航 | `WatchController` 同时听 WXT 的 `wxt:locationchange` 和 YouTube 的 `yt-navigate-finish`；每个视频一个会话，切换时整体销毁 |
| SRT/VTT 是主路径 | 导入的字幕（`timingConfidence: exact`）始终优先，并且只有它支持字幕列表和按句跳转 |
| YouTube 字幕只做尽力而为 | 未导入文件时，`LiveCaptions` 读取播放器当前渲染的 CC 文字，只提供“当前这一句”的点词查义，不产生时间轴；界面标注“尽力而为”，不调用下载接口 |
| 不编造释义 | 词典没有的词显示“暂无释义”，并允许用户添加“我的释义” |
| 隐私 | `permissions: ['activeTab', 'scripting']`，无 host_permissions；网页查词脚本只在用户点击后注入当前标签页；没有任何网络请求，除了加载扩展自带的词典文件 |

## 2. 模块

| 目录 | 职责 | 依赖浏览器 API |
|---|---|---|
| `src/captions` | `CaptionCue`、SRT/VTT 解析、`CueIndex` 时间查找 | 否 |
| `src/dict` | 词典封装、分词、词形还原、词典加载器 | 只有加载器用 fetch |
| `src/vocab` | 生词状态类型、设置、备份格式与合并、提醒规则 | 否 |
| `src/storage` | 消息协议与校验、background 路由、IndexedDB 实现、content 端客户端 | IndexedDB（仅 idb-store） |
| `src/youtube` | URL 识别、播放器会话、导航控制、字幕 DOM 观察（诊断）、轨道探测（诊断） | DOM |
| `src/content` | 叠加层状态、字幕同步、控制器、React 界面与挂载 | DOM、React |
| `scripts` | 从 ECDICT 生成精简词典 | Node |

大部分逻辑是纯函数或依赖注入，所以能在 Vitest 中测试。浏览器专属的部分集中在 `entrypoints/`。

## 3. 数据模型

IndexedDB 数据库 `lingualens`，版本 2。升级只新增仓库，从不删除。

| 仓库 | 主键 | 内容 |
|---|---|---|
| `kv` | key | 设置（`settings`）、上次导出时间、上次提醒时间、诊断计数器 |
| `sw_log` | 自增 | 最近 50 次 service worker 启动记录（诊断） |
| `vocab` | lemma | `{ lemma, status: known/learning/unknown, createdAt, updatedAt, lastWord? }` |
| `custom_defs` | lemma | `{ lemma, text, updatedAt }` |

**生词状态以词元为单位**：running、ran、runs 都记在 run 下。词元来自 ECDICT 的 exchange 字段，规则兜底处理规则变化；方法不依赖上下文，所以 left 会归到 leave。词卡会同时显示词元和原词自身的释义，减少误解。

**备份文件**（`schemaVersion: 1`）：

```json
{
  "format": "lingualens-backup",
  "schemaVersion": 1,
  "appVersion": "0.0.1",
  "exportedAt": "2026-10-08T00:00:00.000Z",
  "vocab": [{ "lemma": "run", "status": "known", "createdAt": 0, "updatedAt": 0, "lastWord": "ran" }],
  "customDefinitions": [{ "lemma": "zorg", "text": "…", "updatedAt": 0 }],
  "settings": { "pauseOnLookup": false, "showDiagnostics": false, "highlightRare": false, "rareRankThreshold": 8000, "backupReminderDays": 30 }
}
```

导入规则：按 `updatedAt` 后写者胜，不删除本机已有记录；格式错误的单条记录跳过并报告；`schemaVersion` 高于当前版本时整体拒绝。

## 4. 关键流程

1. **导入字幕**：content 读取文件 → 解析为 `CaptionCue[]` → 建 `CueIndex` → 收集去重单词 → `ll/annotate` 一次性取回词元、状态和词频 → 渲染高亮。
2. **同步**：播放时 `CueSync` 每帧查询 `CueIndex`，只在当前字幕集合变化时更新界面；暂停、跳转时单次更新。
3. **查词**：鼠标在单词上按下并在同一个词上松开 → `ll/lookup`（附带所在字幕行和词序号）→ background 词形还原、查词典、查生词表和自定义释义，并用 `findPhrases` 找出包含该词的短语 → 词卡。按下后拖到同一行另一个词再松开，或 Shift+点击 → `ll/phrase-lookup` → `matchSelection` 整段匹配，失败时列出范围内的短语 → 短语词卡。短语逻辑在 `src/dict/phrases.ts`，与 UI 共用 `lineWords` 的词序号。词卡放在字幕框上方并限制高度，不遮挡英文字幕。
4. **标记**：`ll/vocab-set` → 返回新记录 → 本地把同一词元的所有词形一起更新高亮。
5. **YouTube 字幕模式**：`captionMode()` 在“有导入文件 → file；否则开关开启 → youtube；否则 none”中选择。youtube 模式下 `LiveCaptions` 监听 `#movie_player` 子树变化，读取 `.caption-visual-line` / `.ytp-caption-segment` 文字和 CC 按钮状态，只对新出现的单词发 `ll/annotate`。同时把 `.ytp-caption-window-container` 用内联样式设为透明，离开该模式时恢复原值。
6. **网页查词（LL-003）**：工具栏弹窗（`entrypoints/popup`）用 `scripting.executeScript` 把未列入 manifest 的 `web-lookup.js` 注入当前标签页（`activeTab` 授权），并设置 ON 角标；background 在标签页开始加载新文档时清除角标。脚本在 `<html>` 上挂一个 shadow root 图层，`WebLookup` 被动监听 mouseup：一个英文单词 → `ll/lookup`（附带所在文本的上下文以查找短语），2–12 个词 → `ll/phrase-lookup`；输入框、可编辑区和代码块排除。词卡逻辑由 `CardController`（`src/content/card-controller.ts`）提供，YouTube 叠加层和网页查词共用；词卡界面在 `src/content/ui/WordCard.tsx`，样式在 `card.css`。生词状态写入同一个 IndexedDB，与 YouTube 共用生词本。
   **机器翻译（LL-004）**：`TranslatorService`（`src/web/translator.ts`）封装 Chrome 内置 Translator（en→zh，本机运行），优先在隔离环境直接调用，否则经页面 MAIN world 的 `translator-bridge.js` 以 postMessage 代为翻译。2–12 个词的短语词卡在词典结果之外自动附上 `card.mt`（选区译文 + 所在整句译文）；更长的选区显示“译”按钮，点击后打开 `kind: 'text'` 的译文卡片。机器翻译结果只放在卡片状态中，不写入存储。
7. **已出现的字幕列表**：youtube 模式下每个可见字幕行以“首次出现时的视频时间”为键插入 `LiveTranscript`（有序数组，二分插入），8 秒窗口内同文去重、前缀增长合并。`Coverage` 根据 timeupdate 和 seeking 记录实际播放过的区间，`buildTranscriptView` 在不连续处插入空缺标记。全部只在内存中，`detachSession` 时清空；广告期间和会话开始时的残留文字不记录。
8. **备份提醒**：每次页面加载最多检查一次 `ll/reminder-check`；满足条件时 background 先记下提醒时间，再返回 `remind: true`，保证每个周期只提醒一次。

## 5. 与 YouTube 的交互约定

- 叠加层挂在 `#movie_player` 内，全屏时随播放器一起显示。宿主元素 `pointer-events: none`，只有字幕框、按钮和词卡接收点击。
- 叠加层内的点击、双击、滚轮事件在宿主处停止冒泡，避免触发播放器的播放/暂停和全屏。
- 在文本框中输入时阻止按键冒泡，避免触发 YouTube 快捷键。按钮在 mousedown 时不获取焦点，所以空格键仍然控制视频。
- 不主动暂停视频，除非用户在设置中开启“查词时暂停”。

## 6. 已知的设计取舍

- 词典约 4.3 MB，由 background 在每个 service worker 实例中首次查词时加载并解析。Node 中测得解析加索引约 60–75 ms；Chrome 中的实际耗时待手动测试记录。
- 字幕文件与视频的对应关系不持久化：切换视频后需要重新导入。
- 词形还原不依赖上下文。
