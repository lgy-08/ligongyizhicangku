# LinguaLens（LL-001 技术可行性原型）

沉浸式英语学习 Chrome 扩展的**技术可行性验证原型**。本阶段不是产品，界面只是诊断面板。
验证结论见 [FEASIBILITY_REPORT.md](./FEASIBILITY_REPORT.md)。

## 环境

| 工具 | 本机实测版本 |
|---|---|
| Node.js | v24.21.0（WXT 0.21.4 要求 >= 22） |
| npm | 11.19.0 |
| Chrome | 154.0.8037.98 |

技术栈：WXT 0.21.4 + TypeScript 5.9.3 + Manifest V3 + Vitest 5.0.3（DOM 测试用 happy-dom）。
TypeScript 固定在 5.9.3：7.x 是原生重写版，与 WXT/Vitest 工具链的兼容性未验证。

## 安装与构建

```powershell
cd D:\Projects\LinguaLens
npm install          # 只安装到项目内 node_modules，postinstall 会运行 wxt prepare
npm run compile      # tsc 类型检查
npm test             # Vitest 单元测试
npm run build        # 产物在 .output\chrome-mv3
```

开发模式可用 `npm run dev`。它会让 WXT 启动一个独立的 Chrome 实例并自动加载扩展。LL-001 的验收以手动加载生产构建为准。

## 在 Chrome 中加载

1. 先运行 `npm run build`。
2. 打开 `chrome://extensions`。
3. 打开右上角“开发者模式”。这是加载未打包扩展的必要开关，需要你自己操作。
4. 点击“加载已解压的扩展程序”，选择 `D:\Projects\LinguaLens\.output\chrome-mv3`。
5. 打开任意 `https://www.youtube.com/watch?v=...` 页面，右下角会出现 “LinguaLens LL-001” 诊断面板。
6. 代码修改后重新 `npm run build`，再在扩展卡片上点“重新加载”，并刷新 YouTube 页面。

扩展**不申请任何 permissions 或 host_permissions**，只在 `*://www.youtube.com/*` 注入两个内容脚本：

- `youtube.js`（隔离环境）：负责播放器监听、诊断面板、字幕层和 SRT/VTT 导入。
- `youtube-probe.js`（MAIN world）：只读取字幕轨道的**元数据**，不请求 timedtext 接口，也不转发 baseUrl。

## 诊断面板功能

| 区块 | 作用 |
|---|---|
| Player | 当前时间、时长、播放状态 |
| Events | play / pause / seeking / seeked / loadedmetadata 等事件日志，以及导航状态 |
| Caption tracks | 字幕轨道元数据：语言、人工或自动、是否有 baseUrl（不使用） |
| YouTube on-screen caption | 从页面字幕 DOM 观察到的当前文字，以及据此生成的 `estimated` 字幕条数 |
| Storage channel | “Counter +1” 写入、“Read counter” 读取、“SW status” 显示 service worker 实例 ID |
| Import SRT / VTT | 导入本地字幕文件，点击任一行跳转到对应时间，播放时在视频上方叠加显示 |
| Copy diagnostics JSON | 把面板数据复制到剪贴板，用于填写测试结果 |

示例字幕文件在 `fixtures/` 目录：`sample-en.srt`、`sample-en.vtt`，以及用于验证错误提示的 `broken.srt`。

## 目录结构

```
entrypoints/
  background.ts             service worker：IndexedDB + 消息路由
  youtube.content.ts        隔离环境内容脚本
  youtube-probe.content.ts  MAIN world 字幕轨道元数据探测
src/
  captions/   CaptionCue 类型、SRT/VTT 解析器、时间匹配 CueIndex
  youtube/    URL 识别、PlayerSession、WatchController（SPA 导航）、字幕 DOM 观察器、轨道探测
  storage/    消息协议、background 路由、IndexedDB 实现、content 端客户端
  ui/         诊断面板（shadow DOM）、字幕叠加层
tests/        Vitest 单元测试
fixtures/     手动测试用字幕文件
```

## 测试说明

`npm test` 运行的是**单元测试**：解析器、时间匹配、监听器注册与清理、导航状态重置、缺字幕或缺播放器场景、存储消息路由。
它们使用 happy-dom 和内存存储，**不能代替真实 Chrome 验收**。真实浏览器测试步骤和结果记录见 FEASIBILITY_REPORT.md 第 8 节。
