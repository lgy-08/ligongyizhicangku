# LL-001 技术可行性报告

- 日期：2026-10-08
- 环境：Windows 11 Home（10.0.26200），Chrome 154.0.8037.98，Node v24.21.0，npm 11.19.0
- 状态：**代码、构建和单元测试已完成；真实 Chrome 行为尚未验证。** 第 8 节的手动测试需要你执行，并提供三个测试视频链接。

> 说明：本次会话没有可用的浏览器自动化工具。按指令要求，我没有用模拟测试代替真实验证。下文凡是“尚未验证”的内容，都必须等第 8 节的手动测试结果回填后才能下结论。

## 1. 结论总览

| 项目 | 状态 | 依据 |
|---|---|---|
| WXT + MV3 项目可构建 | ✅ 已验证 | `npm run build` 成功，产物 30.07 kB |
| 最小权限 manifest | ✅ 已验证 | 产物 manifest 中 `permissions: []`，无 host_permissions |
| TypeScript 类型检查 | ✅ 已验证 | `tsc --noEmit` 退出码 0 |
| SRT / VTT 解析器 | ✅ 已验证（单元测试） | 34 个解析相关测试通过 |
| 字幕排序与时间匹配 | ✅ 已验证（单元测试） | 10 个测试，包含重叠字幕和 1 万条规模 |
| 监听器注册与清理、导航重置 | ✅ 已验证（happy-dom） | 16 个测试；真实 YouTube 页面尚未验证 |
| 存储消息路由 | ✅ 已验证（内存存储） | 11 个测试；真实 IndexedDB 尚未验证 |
| 扩展能被 Chrome 加载 | ⏳ 尚未验证 | 需手动测试 T1 |
| YouTube 播放器检测、事件响应、SPA 导航 | ⏳ 尚未验证 | 需手动测试 T2–T4 |
| 三类视频的字幕读取 | ⏳ 尚未验证 | 需你提供视频链接，并执行手动测试 T5 |
| IndexedDB 刷新或重启后数据保留 | ⏳ 尚未验证 | 需手动测试 T6 |
| service worker 挂起与唤醒表现 | ⏳ 尚未验证（文档结论见第 3 节） | 需手动测试 T7 |
| SRT/VTT 点击跳转（真实视频） | ⏳ 尚未验证 | 需手动测试 T8 |
| 验证失败项 | 暂无 | 真实环境测试尚未开始，不代表没有失败 |

## 2. YouTube 字幕接入：方案、限制与风险

### 2.1 原型实现的三条读取路径

| 路径 | 数据类型 | timingConfidence | 实现位置 |
|---|---|---|---|
| A. MAIN world 读取播放器对象中的字幕轨道列表 | 只有**轨道元数据**：语言、名称、人工或自动、是否存在 baseUrl。**不含字幕文本和时间轴** | 不产生 cue | `src/youtube/track-probe.ts` |
| B. 观察 YouTube 渲染的字幕 DOM（`.ytp-caption-segment` 等） | **页面当前可见的字幕文本**，以及据此构造的估算字幕 | `estimated` | `src/youtube/caption-dom-observer.ts` |
| C. `video.textTracks` | 原生 TextTrack 数量 | 不产生 cue | 记录在诊断面板 |
| D. 用户导入 SRT/VTT | **完整结构化字幕** | `exact` | `src/captions/*` |

按你没有否决的默认方案，原型**不请求** timedtext（baseUrl）接口。它是未公开的私有接口，指令禁止依赖未经验证的私有下载接口。因此，原型目前**没有任何路径能从 YouTube 拿到完整结构化字幕**。完整时间轴只能来自用户导入的 SRT/VTT。

### 2.2 指令中“重点回答”的问题

以下“预期”是根据实现方式推断的，**不是验证结果**。每一条都要用第 8 节 T5 的实测结果替换。

| 问题 | 当前状态 |
|---|---|
| 能读到哪些字幕信息？ | 预期：A 路径能读到轨道列表，并区分人工和自动字幕；B 路径能读到屏幕上正在显示的文字，前提是用户开启了 CC。**尚未验证** |
| 能否得到完整时间轴？ | 不请求 timedtext 的前提下**不能**，这是设计层面的结论。B 路径只能得到“已经播放过的部分”的估算时间轴 |
| 能否得到单条字幕的准确起止时间？ | **不能标为准确**。B 路径的起止时间等于文字出现和消失时的 `video.currentTime`，包含 DOM 变更延迟，并且一律标为 `estimated` |
| 跳转后字幕状态是否正确？ | 单元测试已验证：跳转时会在跳转前的时间点关闭当前估算字幕，屏幕上的旧文字不会在新位置生成新字幕。真实页面**尚未验证** |
| 切换视频后是否有旧字幕残留？ | 单元测试已验证：切换视频时会销毁观察器、清空导入的字幕并隐藏叠加层。真实页面**尚未验证** |

### 2.3 已知限制与风险

1. **没有公开的完整字幕接口。** YouTube Data API 的 captions.download 需要 OAuth，并且只能下载自己有编辑权限的视频的字幕，不适用于任意视频。这一条来自我的已有知识，本次没有重新核实。timedtext 地址可能附带令牌校验，这一点同样**未核实**，因为本次没有请求它。
2. **DOM 路径很脆弱。** 字幕 DOM 的 class 名不是公开 API，随时可能改变。它还要求用户开启 CC，并且自动字幕是逐词滚动显示的，估算字幕会被切得很碎。
3. **MAIN world 数据可能过期。** SPA 导航后，`ytInitialPlayerResponse` 仍是首个视频的数据。原型优先调用播放器的 getPlayerResponse，并比对 videoId，不一致时最多重试 6 次。这种行为也需要实测。
4. **广告。** 广告和正片共用同一个 video 元素，广告期间的时间和时长属于广告。原型没有实现广告识别，这是已知问题。
5. **页面可以伪造 postMessage。** MAIN world 的结果经 postMessage 回传，页面脚本理论上能伪造。原型用随机 nonce 加结构校验降低风险，而且只传元数据。正式版不应信任这条通道上的任何数据。

## 3. 数据存储通道结论

**实现方式：** IndexedDB 只在 background service worker 中打开，数据库名为 `lingualens`，包含 `kv` 和 `sw_log` 两个对象仓库。content script 只通过 `chrome.runtime.sendMessage` 发送 `ll/*` 消息，background 用 `sendResponse` 加 `return true` 异步回复，并校验发送方 ID。计数器自增在单个 readwrite 事务中完成。

**已验证（单元测试）：** 消息校验、读写删除往返、计数器、错误转换。存储层抛出的异常会变成 `{ ok: false }`，不会让调用方崩溃。content 端的扩展上下文失效、无响应和超时都会返回清晰的错误。

**尚未验证：** 真实 IndexedDB 读写、刷新页面后数据保留、重启浏览器后数据保留，见 T6。

**service worker 挂起与唤醒（Chrome 官方文档）：**
- 空闲 30 秒后终止。收到事件或调用扩展 API 会重置计时。单个请求超过 5 分钟，或 fetch 响应超过 30 秒，也会被终止。
- 终止后全局变量全部丢失。下一条消息到来时 Chrome 会重新启动 worker，并重新执行顶层代码。
- 原型的应对：
  - 每次 worker 启动时生成新的实例 ID，并写入 `sw_log`。面板的 “SW status” 可以显示实例 ID 是否变化。
  - 数据库连接缓存在 worker 实例内，被终止后由新实例重新打开。
  - 消息监听器在顶层同步注册，保证 Chrome 能为这条消息唤醒 worker。
- 预期表现：空闲超过 30 秒后点 “SW status”，实例 ID 会变化，数据仍然可读。第一次调用会多出 worker 启动的延迟。**以上全部尚未实测**，见 T7。

## 4. 调研结论（只调研，未接入）

### 4.1 词典数据

| 候选 | 许可证 | 内容 | 能否合法打包 |
|---|---|---|---|
| **ECDICT**（skywind3000/ECDICT） | 仓库标注 **MIT** | 基础版 76 万词条。字段包括音标、英文释义、中文翻译、词性、柯林斯星级、牛津核心词、考试标签（中考、高考、四六级、雅思等）、BNC 和当代语料词频，以及 exchange 词形变化字段。另附 lemma.en.txt 词形还原表 | MIT 允许商用，需保留版权声明。**风险**：词条数据汇集自多个来源，部分来源的授权链需要在 LL-002 中进一步核查 |

**推荐：** 用 ECDICT 并裁剪。按词频和考试标签选出约 3 到 5 万个常用词，转换为压缩的 JSON 或 SQLite 片段，在首次安装时写入 IndexedDB。打包体积要在 LL-002 实测。完整 CSV 体积较大，不适合直接塞进扩展。

### 4.2 词形还原

| 候选 | 许可证 | 体积（npm 解包后） | 说明 |
|---|---|---|---|
| ECDICT exchange 字段 + lemma.en.txt | MIT | 随词典数据，无需额外代码 | 查表方式，能覆盖 ran→run 这类不规则变化；生僻词需要规则兜底 |
| wink-lemmatizer 3.0.4 | MIT | 35 KB，但依赖 wink-lexicon（12,274 KB） | 基于 WordNet 数据。依赖体积大，最后发布于 2023 年 |
| compromise 14.18.0 | MIT | 2,671 KB | 完整 NLP 库，能做词形还原和词性标注；仍在活跃维护 |
| wink-nlp 2.4.0 + wink-eng-lite-web-model 1.8.1 | MIT | 640 KB + 3,735 KB | 需要语言模型，体积大 |
| natural 8.1.1 | MIT | 13,470 KB | 面向 Node，体积过大 |

**running / ran 的实际还原效果尚未验证。** 调研项不得接入，所以我没有安装这些库来实测。
**推荐：** 先用 ECDICT 查表，再用少量规则兜底处理 -ing、-ed、-s 等规则变化。这样不增加依赖，并且和词典数据同源。是否引入 compromise，等 LL-002 实测准确率和打包体积后再决定。

### 4.3 Chrome 内置端侧 AI

| API | 状态（官方文档） | 依赖的模型 | 对本项目的意义 |
|---|---|---|---|
| Translator API | Chrome 138 起稳定；可用于扩展 | 专用翻译模型，不需要 Gemini Nano | 可用于句子翻译。**Web Worker 中不可用**，而扩展 service worker 也是 worker，所以只能在页面、扩展页或 offscreen 文档中调用。首次创建翻译器需要用户激活，模型按语言对下载 |
| Language Detector API | Chrome 138 起稳定 | 专用模型 | 可用于判断字幕是不是英文 |
| Summarizer API | Chrome 138 起稳定 | Gemini Nano | 可选功能 |
| Prompt API | 扩展中从 Chrome 138 起稳定 | Gemini Nano | 可用于“语境释义”，但硬件门槛高 |

Gemini Nano 的要求：Windows 10/11、macOS 13+、Linux 或 Chromebook Plus。Chrome 配置文件所在的磁盘至少要有 22 GB 空闲空间。GPU 需要大于 4 GB 显存，或者 CPU 方案需要 16 GB 内存加 4 核以上。首次下载需要不计流量的网络。不支持移动端。

**本机是否可用尚未验证。** 需要在页面控制台执行第 8 节 T9 的检查。
**推荐：** 把翻译当作可选增强。按 Translator 是否可用分级降级，不可用时只显示词典释义。Prompt API 不能作为核心依赖。

## 5. 推荐的正式实现方式

1. **字幕来源分级，并始终带上 timingConfidence。**
   - 第一级：用户导入的 SRT/VTT，时间为 exact，已具备。
   - 第二级：YouTube DOM 可见字幕，时间为 estimated，只用于“当前这句”的查词和高亮，不用于需要精确时间轴的功能。
   - 是否走 timedtext，需要单独立项评估合规性和稳定性，由你决定。在此之前，产品文案不能承诺“自动获取完整字幕”。
2. **页面层**：保留 WatchController 加 PlayerSession 的单会话模型，切换视频时整体销毁再重建。导航信号同时使用 WXT 的 locationchange 和 YouTube 的 `yt-navigate-finish`。
3. **存储层**：IndexedDB 只放在 background，统一使用 `ll/*` 消息协议。消息类型和返回值用 TypeScript 联合类型约束。批量写入要合并成一个事务。
4. **UI**：LL-002 引入 React，放在 shadow DOM 中。字幕层继续使用 pointer-events: none，保证不拦截播放器点击。

## 6. 下一阶段建议与工程量估算

**建议 LL-002 先做：**
1. 回填第 8 节的实测结果，修复发现的问题。
2. 编写 ARCHITECTURE.md，确定字幕来源分级和数据模型。
3. 实现 ECDICT 裁剪导入，并实测打包体积和查词速度。
4. 实测词形还原的准确率，用常见不规则动词表测试。
5. 在本机验证 Translator 的可用性和延迟。
6. 把时间匹配从 timeupdate（约 250 ms 粒度）改成播放时用 requestAnimationFrame 驱动。

**工程量估算（1 名开发者，人天，未含真实测试中可能发现的问题）：**

| 模块 | 估算 |
|---|---|
| LL-001 实测回填与修复 | 1–2 |
| 词典裁剪、导入、查词 | 3–5 |
| 词形还原（查表加规则）与测试 | 2–3 |
| 字幕交互：点词查词、生词高亮、句子跳转 | 5–8 |
| 生词本与复习（IndexedDB） | 4–6 |
| React UI 与设置页 | 5–8 |
| 端侧翻译集成与降级 | 2–4 |
| 测试、打包、商店材料 | 3–5 |
| **合计** | **约 25–41 人天** |

如果决定接入 timedtext，需要额外 3–6 人天，并且要单独做合规评估。

## 7. 真实构建和测试输出

以下输出均在 2026-10-08 于本机实际运行得到。

```text
> lingualens@0.0.1 compile
> tsc --noEmit
exit 0

> lingualens@0.0.1 test
> vitest run
 RUN  v5.0.3 D:/Projects/LinguaLens
 Test Files  10 passed (10)
      Tests  86 passed (86)
   Duration  1.04s
exit 0

> lingualens@0.0.1 build
> wxt build
WXT 0.21.4
Building chrome-mv3 for production with Vite 8.3.3
Built extension in 381 ms
  ├─ .output\chrome-mv3\manifest.json                     495 B
  ├─ .output\chrome-mv3\background.js                     3.74 kB
  ├─ .output\chrome-mv3\content-scripts\youtube-probe.js  2.08 kB
  └─ .output\chrome-mv3\content-scripts\youtube.js        23.75 kB
Σ Total size: 30.07 kB
exit 0
```

各测试文件的通过数：

| 文件 | 通过 | 覆盖内容 |
|---|---|---|
| srt.test.ts | 18 | BOM、CRLF 和 CR、`,` 与 `.`、多行、空行、标签、乱序、警告、各类错误信息 |
| vtt.test.ts | 13 | 头部、NOTE/STYLE/REGION、标识符、短时间格式、卡拉 OK 时间戳、错误信息、格式识别 |
| match.test.ts | 10 | 时间解析与格式化、稳定排序、半开区间、重叠字幕、跳转、空集、1 万条规模 |
| fixtures.test.ts | 3 | 手动测试用的三个字幕文件 |
| player-session.test.ts | 5 | 事件快照、每类事件只注册一次、dispose 后全部移除、不拦截事件、跳转参数校验 |
| watch-controller.test.ts | 11 | 幂等、切换视频重置、离开观看页、元素替换、播放器延迟出现、缺播放器超时、过期等待取消、清理异常、快速连续导航 |
| caption-dom-observer.test.ts | 9 | 估算字幕、MutationObserver、跳转处理、去重、销毁后无残留、缺字幕容器 |
| storage.test.ts | 11 | 消息校验、读写删除、计数器、SW 状态、错误转换、客户端超时和上下文失效 |
| track-probe.test.ts | 4 | 元数据提取、不泄露 baseUrl、无字幕视频、异常输入、消息校验 |
| url.test.ts | 2 | 观看页识别；排除 Shorts、嵌入页、移动版和其他域名 |

**这些都是 happy-dom 或 Node 环境下的单元测试，不能当作真实 Chrome 验收。**

## 8. 真实 Chrome 手动测试（待你执行）

**准备：** 按 README 构建并加载扩展。准备三个视频：人工字幕、仅自动生成字幕、无字幕。每个视频最好长于 1 分钟。每项测试完成后，点击面板上的 “Copy diagnostics JSON”，把内容连同观察结果发给我。

| 编号 | 步骤 | 预期 | 实际结果 |
|---|---|---|---|
| T1 | 加载 `.output\chrome-mv3` | 无报错。扩展卡片不显示任何权限请求 | 待填 |
| T2 | 打开人工字幕视频，播放、暂停，拖动进度条到中间 | 面板出现 active；Events 依次出现 play、pause、seeking、seeked；时间和时长正确 | 待填 |
| T3 | 在 YouTube 内点推荐视频切换（不刷新），重复 3 次，再回到首页 | 每次切换出现新的 active videoId；回首页后面板隐藏；事件不重复。Copy diagnostics 中 liveSessions 为 1 或 0 | 待填 |
| T4 | 播放期间点击视频、使用空格键、使用 YouTube 自带进度条和字幕按钮 | 原有播放功能不受影响 | 待填 |
| T5a | 人工字幕视频：开启 CC，播放 30 秒，拖动一次进度 | Caption tracks 显示 [manual] 轨道；DOM 区显示当前字幕文字，estimated 条数增加 | 待填 |
| T5b | 仅自动字幕视频：重复 T5a | 轨道显示 [auto/asr]；记录估算字幕是否被逐词拆碎 | 待填 |
| T5c | 无字幕视频：重复 T5a | 0 个轨道；DOM 区为 (none)；没有报错 | 待填 |
| T5d | 从 T5a 视频切到 T5c 视频 | 不残留上一个视频的字幕文字和轨道信息 | 待填 |
| T6 | 点 Counter +1 三次，然后读取；刷新页面再读取；完全退出 Chrome，重新打开后再读取 | 三次读取的数值一致，没有丢失 | 待填 |
| T7 | 什么都不做等待 60 秒以上，点 SW status；也可以在 `chrome://serviceworker-internals` 对本扩展点 Stop，再点 SW status | 实例 ID 变化，数据仍可读；记录第一次调用的耗时 | 待填 |
| T8 | 导入 `fixtures\sample-en.srt`，点击 “Line 3 at 0:30” 行；再导入 `sample-en.vtt` 和 `broken.srt` | 视频跳到 0:30；叠加层显示对应字幕并标注 exact；broken.srt 显示带行号的错误信息 | 待填 |
| T9 | 在 YouTube 页面的 DevTools 控制台执行下方代码 | 记录三项返回值 | 待填 |

T9 使用的检查代码，只查询可用性，不下载模型：

```js
await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' });
await LanguageDetector.availability();
await LanguageModel.availability();
```

## 9. 已知问题

- 导入字幕的高亮依赖 timeupdate，粒度约 250 ms。
- 字幕 DOM 观察器监听整个 `#movie_player` 子树，对性能的影响尚未测量。
- 没有识别广告，广告期间的事件和时间属于广告。
- 只支持 `www.youtube.com/watch`，不支持 Shorts、嵌入播放器、移动版或直播的特殊情况。
- 切换视频时会清空导入的字幕。这是有意设计，避免把字幕套用到错误的视频上。
- 诊断面板在观看页默认展开，只用于测试，不符合正式版“低打扰”的要求。
- Git 提交身份在仓库内单独配置为 Litianyu08 和你的邮箱，没有改动全局 Git 配置。
