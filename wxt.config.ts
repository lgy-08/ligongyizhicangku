import { defineConfig } from 'wxt';

// Minimal permissions, no `host_permissions`:
// - YouTube content scripts are declared in their entrypoints (matches www.youtube.com only);
// - web-page lookup (LL-003) is injected on demand into the CURRENT tab when the user clicks
//   "在本页启用查词" in the popup: `activeTab` grants that one tab, `scripting` performs the injection.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LinguaLens',
    description: '沉浸式英语学习：YouTube 字幕点词查义、网页查词、标记生词，数据只存本地。',
    permissions: ['activeTab', 'scripting'],
    action: { default_title: 'LinguaLens' },
  },
});
