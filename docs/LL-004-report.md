# LL-004 网页机器翻译：阶段报告

- 日期：2026-10-09
- 依据：用户批准“方案 A（Chrome 内置翻译器）”，先只做网页；圈选 2–12 个词时自动显示机器翻译。
- 前置实测（用户在本机控制台）：`Translator.availability({sourceLanguage:'en', targetLanguage:'zh'})` 在 YouTube 页面和普通网页都返回 `downloadable`；20 条样例中 17 条译对组合意思，3 条习语被直译（not my cup of tea、the ball is in your court、hit the nail on the head）；每次翻译 1–25 毫秒。

## 1. 做了什么

| 部分 | 内容 |
|---|---|
| 翻译服务 | `src/web/translator.ts`：英译中；首次使用下载语言包并报告进度；缓存 300 条；单次 20 秒超时；输入上限 1500 字符；失败原因转成中文提示（不支持、本机不可用、需要点击触发下载、超时、其他错误） |
| 两条通道 | 优先在扩展的隔离环境直接调用 `Translator`；若不可用，通过弹窗同时注入到页面 MAIN world 的 `translator-bridge.js`（1.86 kB）以 postMessage 代为翻译。桥接脚本只回答翻译请求，不读取页面内容、不联网 |
| 短语词卡 | 选中 2–12 个词：先显示词典释义（有则显示，标注“词典”），再自动显示紫色“机器翻译 · 本机”栏：选中部分的译文 + “所在整句”的译文（整句与选区相同时不重复） |
| 长选区 | 选中超过 12 个词（或超过 200 字符、≤ 1500 字符）：选区旁出现“译”按钮，点击后弹出译文卡片；点别处、Esc、滚动时按钮消失 |
| 单词 | 词典查不到的词显示“机器翻译试试”按钮（单词不自动翻译） |
| 整句提取 | 从选区所在段落中按句末标点截取整句，最多 300 字符 |
| 短语词典改进 | 短语上限 5 → 6 个词；允许 one's、oneself、someone、something 等占位词；匹配时 my/your/his/her/its/our/their → one's，myself 等 → oneself。短语从 35,912 增至 36,774，词典 6.32 MB。现在 hit the nail on the head、one's cup of tea、pull oneself together、make up one's mind 都能查到 |
| 设置 | 新增“网页机器翻译”开关（默认开启）；关闭后不翻译、不出现“译”按钮和“机器翻译试试” |
| 权限 | 不变：`activeTab, scripting`，无 host_permissions |

## 2. 验证了什么

```text
> tsc --noEmit        exit 0
> vitest run          Test Files 20 passed (20) / Tests 262 passed (262)，连续 10 次均通过
> wxt build           成功，Σ Total size: 7.11 MB
  translator-bridge.js 1.86 kB · web-lookup.js 245.17 kB · dict/ecdict-lite.json 6.32 MB
  permissions: activeTab, scripting | host_permissions: []
```

新增测试：`translator.test.ts`（直接通道、桥接通道往返、下载进度、缓存、各类失败、长度上限）、网页查词机器翻译流程 7 项、整句提取、段落偏移计算、长选区分类、代词占位匹配、6 词与占位词的词典构建。

## 3. 没验证什么

**真实 Chrome 中的全部翻译行为未验证**，见 `docs/manual-test.md` G 节 M-1 至 M-12。最关键的不确定点：

1. 扩展隔离环境中能否直接使用 `Translator`（不能则走桥接；两条都需实测）。
2. 首次下载语言包需要“用户点击”触发：选中文字的鼠标松开和点击“译”按钮应满足条件，但未实测。若出现“请再点一次”的提示，说明需要调整。
3. 语言包大小和下载时间。
4. 桥接通道下，网页脚本理论上能看到要翻译的文字（本来就是网页自己的文字），也能伪造译文结果；只在直接通道不可用时才使用桥接。

**用户实测（2026-10-09）**：网页机器翻译“运行良好”（未逐项填写 M-1 至 M-12）。

## 4. 已知限制

- 机器翻译偶尔直译习语，仅供参考；词典有该习语时以词典为准。
- YouTube 字幕暂不提供机器翻译（本阶段只做网页）。
- 整句按句末标点切分，“Dr.”“e.g.” 等缩写会被误判为句末。
- 长选区上限约 1500 字符。

## 5. Git

本地提交，未推送。
