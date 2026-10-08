# LL-002 最小可用版本：阶段报告

- 日期：2026-10-08
- 依据：`PHASE1_TASK.md` 第 2–4 节。`PRODUCT_SPEC.md` 不存在，未能参考。
- 前提说明：LL-001 的真实 Chrome 测试**尚未执行**。用户在 LL-001 报告后回复“可以继续”，我据此开始 LL-002，并把 LL-001 遗留的真实环境检查并入 `docs/manual-test.md` 的 B 节。

## 1. 做了什么

完整链路：**导入 SRT/VTT → 与播放进度同步显示 → 点击单词查释义 → 标记 认识 / 半熟 / 不认识 → 刷新和重启后保留 → 导出 JSON（带版本号）并可导入**。

| 部分 | 内容 |
|---|---|
| 词典 | `scripts/build-dict.mjs` 从 ECDICT 生成精简词典：41,621 个词条、35,310 条“词形 → 词元”映射，约 4.3 MB。源数据用 SHA-256 校验版本。词典数据不进 Git |
| 词形还原 | ECDICT exchange 字段查表，加规则兜底。理由见第 4 节 |
| 存储 | IndexedDB 升级到 v2，新增 `vocab`、`custom_defs`，v1 数据保留。全部读写仍只在 background |
| 消息协议 | 新增 lookup、annotate、vocab-set/list、custom-def-set/list、settings-get/set、export、import、reminder-check/dismiss、open-options，全部有输入校验 |
| 播放器内界面 | React + shadow DOM，挂在 `#movie_player` 内（全屏可见）。包括字幕行（每个词可点）、词卡、“LL”菜单、字幕列表（点击跳转）、导入结果提示、备份提醒 |
| 同步 | 播放时每帧（requestAnimationFrame）查询当前字幕，只在变化时重绘；暂停和跳转时单次更新。取代了 LL-001 约 250 ms 粒度的 timeupdate |
| 设置页 | 生词本（筛选、搜索、改状态、删除、显示我的释义）、导出和导入、设置、许可证与隐私说明。点击扩展图标即可打开 |
| 设置项 | 查词时暂停（默认关）、低频词虚线提示（默认关，基于 ECDICT 公开词频）、备份提醒天数（默认 30，0 为关闭）、诊断面板（默认关） |
| 备份提醒 | 有数据且超过设定天数未导出时，每个周期只提醒一次，可“不再提示” |
| LL-001 诊断 | 诊断面板和字幕轨道探测保留，但默认隐藏，需在设置中开启 |
| 文档 | `ARCHITECTURE.md`、`docs/manual-test.md`、README（含导出与备份）、本报告 |

## 2. 验证了什么

以下输出均在 2026-10-08 于本机实际运行得到。

```text
> tsc --noEmit                 exit 0
> vitest run
 Test Files  14 passed (14)
      Tests  153 passed (153)
> wxt build                    Built extension, Σ Total size: 4.84 MB
  ├─ manifest.json                       586 B
  ├─ options.html                        471 B
  ├─ background.js                       14.81 kB
  ├─ chunks/options-*.js                 227.48 kB
  ├─ content-scripts/youtube-probe.js    2.08 kB
  ├─ content-scripts/youtube.js          258.58 kB
  ├─ assets/options-*.css                1.89 kB
  ├─ dict/ecdict-lite.json               4.33 MB
  └─ dict/LICENSE-ECDICT.txt             1.06 kB
```

产物 manifest：`permissions: []`，无 host_permissions，内容脚本只匹配 `*://www.youtube.com/*`。

| 测试文件 | 通过 | LL-002 新增或改动的覆盖内容 |
|---|---|---|
| dict.test.ts | 27 | 词典结构与校验、词形还原（含**真实 ECDICT 构建产物**上的 running/ran/runs→run、went→go、mice→mouse、was→be、better→good 等 11 例）、分词、加载器缓存与失败重试 |
| dict-build.test.ts | 6 | CSV 解析（引号、转义、CRLF、BOM）、exchange 解析、释义裁剪、词条筛选与映射优先级 |
| storage.test.ts | 24 | **在 fake-indexeddb 上运行真实 IndexedDB 代码**：v1→v2 升级不丢数据、生词增删改、自定义释义、查词、批量标注、设置、导出→全新环境导入完整恢复、导入合并规则、错误文件、提醒节奏、错误转换 |
| overlay.test.ts | 13 | 字幕同步（逐帧、跳转、停止安全）、高亮规则、导入→同步→标注、切换视频无残留、过期导入丢弃、查词与标记联动所有词形、查词失败提示、默认不暂停 / 开启后暂停并恢复、提醒每页只检查一次 |
| backup.test.ts | 8 | 备份往返、版本过新拒绝、坏记录跳过、合并规则、提醒规则、设置清洗 |
| 其余 9 个文件 | 75 | LL-001 的解析、匹配、导航、监听器、探测测试，全部仍通过 |

词典解析耗时：在 Node 中解析 4.3 MB 并建索引，5 次分别为 74、71、61、74、75 ms。这只代表 Node，Chrome service worker 中的耗时需要手动记录。

## 3. 没验证什么

**真实 Chrome 中的所有行为都尚未验证**，包括验收标准 1–10 的每一项。本会话没有浏览器自动化工具，我没有用模拟测试冒充。请按 `docs/manual-test.md` 执行 A1–A22 和 B 节。

尤其需要实测的风险点：

1. 点击叠加层时，事件是否真的不会触发 YouTube 的播放/暂停和全屏（A6、A18）。
2. 字幕层在小播放器、剧场模式、全屏下的位置是否遮挡控件（A19）。
3. 文本框输入时 YouTube 快捷键是否被正确屏蔽（A18）。
4. service worker 冷启动后首次查词的延迟（B 节 T7）。
5. 浏览器重启后数据是否保留（A11）。

## 4. 词形还原库的选择与理由

| 候选 | 许可证 | 体积 | 结论 |
|---|---|---|---|
| **ECDICT exchange 字段 + 规则兜底**（采用） | MIT | 不增加依赖，映射表随词典打包 | 能处理不规则变化，并且和释义同源，查到的词元一定有释义 |
| ECDICT lemma.en.txt | 文件头声明“仅供研究和教育用途” | 2.3 MB | **许可证不明确，不使用** |
| compromise 14.18.0 | MIT | npm 解包 2,671 KB | 功能强，但对单个词不依赖上下文时，优势有限；体积大 |
| wink-lemmatizer 3.0.4 | MIT | 依赖 wink-lexicon，12,274 KB | 太大 |

任务书要求“选一个轻量、许可证合适的库”。我选择的是**数据加规则**的方式，没有引入第三方库。原因是：它满足“轻量”和“许可证明确”，并且在真实数据上的测试已覆盖 running/ran→run。如果你坚持必须使用独立的库，compromise 是首选替代方案，代价是内容脚本体积增加约数百 KB。

## 5. 已知问题与限制

- **词形还原不依赖上下文**：left 会归到 leave，saw 会归到 see，glasses 会归到 glass。词卡会同时显示原词自身的释义（如果词典有），但状态仍记在词元下。
- **字幕需要每个视频单独导入**：切换视频后会清空，不记住文件与视频的对应关系。
- **只支持 `www.youtube.com/watch`**：不支持 Shorts、嵌入播放器、移动版。
- **导出时间按“生成备份数据”记录**：如果用户在保存对话框中取消，扩展仍会认为已导出，提醒时钟会被重置。
- **Esc 不一定能关闭词卡**：按钮不获取焦点，按键通常到不了词卡，需要点 × 关闭。
- **词典数据不在仓库中**：新环境需要先运行 `npm run dict -- --download`。如果上游 ECDICT 改变，脚本会给出 SHA-256 不一致的警告。
- **ECDICT 第三方来源授权**：仓库整体是 MIT，但 README 提到部分词条来自其他词典来源，其授权链未逐一核查。这是我把词典数据排除在 Git 之外的原因之一。如果将来要公开发布，建议先做法律评估。
- **广告**：广告期间的时间属于广告，导入的字幕会按广告时间显示。

## 6. Git

本阶段在本地提交，未推送。提交前已确认 `data-src/` 和生成的词典 JSON 都在 `.gitignore` 中。
