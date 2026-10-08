import { defineConfig } from 'wxt';

// Minimal permissions: no `permissions`, no `host_permissions`.
// Content-script matches are declared in each entrypoint; the dictionary ships in public/dict.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LinguaLens',
    description: '沉浸式英语学习：导入字幕、点词查义、标记生词，数据只存本地。',
    permissions: [],
    action: { default_title: 'LinguaLens 生词本与设置' },
  },
});
