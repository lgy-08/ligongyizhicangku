# 校园跑章法器

帮助大学生规划一学期固定次数的校园跑，避免把大量次数拖到学期末。

## 运行方式

无需安装任何依赖，直接用浏览器打开 `index.html` 即可：

- Windows：双击 `index.html`，或在浏览器地址栏输入该文件路径。
- 也可在项目目录起一个本地静态服务器（可选）：
  ```powershell
  python -m http.server 8000
  # 然后访问 http://localhost:8000
  ```

## 文件结构

- `index.html` —— 页面结构
- `style.css` —— 样式（简洁、无渐变、响应式）
- `core.js` —— 核心计算逻辑（纯函数，浏览器与 Node 通用）
- `script.js` —— 交互与 localStorage 持久化
- `test.js` —— 日期与边界条件测试

## 运行测试

```powershell
node test.js
```
