# LinguaLens

沉浸式英语学习 Chrome 扩展（Manifest V3）。在 YouTube 观看页导入 SRT/VTT 字幕，字幕随播放同步显示；点击单词查看释义，标记“认识 / 半熟 / 不认识”；数据只保存在本机，可导出 JSON 备份。

当前阶段：**LL-002 最小可用版本**。设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)，阶段报告见 [docs/LL-002-report.md](./docs/LL-002-report.md)，手动验收清单见 [docs/manual-test.md](./docs/manual-test.md)，技术验证见 [FEASIBILITY_REPORT.md](./FEASIBILITY_REPORT.md)。

## 环境

| 工具 | 本机实测版本 |
|---|---|
| Node.js | v24.21.0（WXT 0.21.4 要求 >= 22） |
| npm | 11.19.0 |
| Chrome | 154.0.8037.98 |

技术栈：WXT 0.21.4、TypeScript 5.9.3、React 19.3、Manifest V3、Vitest 5.0.3。

## 安装与构建

```powershell
cd D:\Projects\LinguaLens
npm install                    # 依赖只装在项目内，postinstall 会运行 wxt prepare
npm run dict -- --download     # 下载 ECDICT（约 66 MB）并生成精简词典，只需一次
npm run build                  # 产物在 .output\chrome-mv3
```

- 词典源文件放在 `data-src\`，生成的 `public\dict\ecdict-lite.json` 约 4.3 MB。两者都不提交到 Git，由脚本在本地重新生成。
- 已经下载过 `data-src\ecdict.csv` 时，直接运行 `npm run dict` 即可。
- 不生成词典也能构建和使用，但查词时会提示“词典未加载”，只能使用“我的释义”。

## 在 Chrome 中加载

1. 打开 `chrome://extensions`，打开右上角“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择 `D:\Projects\LinguaLens\.output\chrome-mv3`。
3. 打开任意 `https://www.youtube.com/watch?v=...`，视频左上角会出现半透明的 “LL” 按钮。
4. 代码修改后重新 `npm run build`，在扩展卡片上点“重新加载”，再刷新 YouTube 页面。

扩展**不申请任何 permissions 或 host_permissions**，只在 `www.youtube.com` 注入内容脚本。

## 使用

1. 在观看页点 “LL” → “导入字幕文件…”，选择与视频对应的 `.srt` 或 `.vtt` 文件。建议关闭 YouTube 自带的 CC。
2. 字幕显示在视频下方。点击任意单词打开词卡：
   - 显示词元（例如 ran → run）、音标和中文释义。
   - 词典里没有的词会显示“暂无释义”，可以“添加我的释义”。
   - 点“认识 / 半熟 / 不认识”标记；同一词元的所有词形一起高亮。
3. “LL” → “字幕列表”可以点击任一句跳转。
4. 点击浏览器工具栏中的扩展图标，或 “LL” → “生词本 / 备份 / 设置”，打开设置页。

## 导出与备份学习数据

学习数据存在 Chrome 扩展自己的 IndexedDB 中，**不在项目目录里，GitHub 也不会备份它**。卸载扩展或清除浏览器数据会删除它。

- **导出**：设置页 →“导出 JSON 备份”，得到 `lingualens-backup-YYYYMMDD-HHmm.json`。文件带 `format` 和 `schemaVersion`，包含生词状态、我的释义和设置。
- **导入**：设置页 →“从 JSON 导入…”。同一个词以修改时间较新的记录为准，不会删除本机已有的词。
- **提醒**：超过设定天数（默认 30 天）未导出时，观看页右下角会轻提示一次，可以选择“不再提示”。

## 测试

```powershell
npm run compile   # tsc 类型检查
npm test          # Vitest 单元测试
```

单元测试覆盖字幕解析、时间同步、词形还原、词典生成、状态存储（fake-indexeddb 上运行真实的 IndexedDB 代码）、导出导入和提醒规则。它们**不能代替真实 Chrome 验收**，真实环境请按 [docs/manual-test.md](./docs/manual-test.md) 执行。

## 目录结构

```
entrypoints/
  background.ts             service worker：IndexedDB、词典、消息路由
  youtube.content.ts        观看页内容脚本：导航、播放器、叠加层、诊断
  youtube-probe.content.ts  MAIN world 字幕轨道元数据探测（诊断用）
  options/                  生词本与设置页（React）
src/
  captions/   SRT/VTT 解析、CueIndex
  dict/       词典、分词、词形还原、加载器
  vocab/      生词状态、设置、备份格式、提醒规则
  storage/    消息协议、路由、IndexedDB、客户端
  youtube/    URL、播放器会话、导航控制、诊断用字幕探测
  content/    叠加层状态、字幕同步、控制器、React 界面
scripts/      build-dict.mjs（ECDICT → 精简词典）
tests/        Vitest 单元测试
fixtures/     手动测试用字幕文件
docs/         阶段报告与手动验收清单
```

## 许可与数据来源

词典数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)，MIT License，Copyright (c) 2025 Linwei。许可证全文随扩展打包在 `dict/LICENSE-ECDICT.txt`。同一仓库中的 `lemma.en.txt` 声明“仅供研究和教育用途”，许可证不明确，本项目不使用。
