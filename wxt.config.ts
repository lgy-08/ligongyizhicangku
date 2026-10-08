import { defineConfig } from 'wxt';

// LL-001: minimal permissions. No `permissions`, no `host_permissions`.
// Content-script matches are declared in each entrypoint.
export default defineConfig({
  manifest: {
    name: 'LinguaLens (LL-001 prototype)',
    description: 'Feasibility prototype: YouTube player hooks, caption probes, SRT/VTT import, IndexedDB channel.',
    permissions: [],
  },
});
