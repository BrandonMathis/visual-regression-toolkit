// A real consumer would `import { defineVisualConfig } from '@thisdot/visual-regression'`;
// the fixture exports a plain object literal so it never has to resolve the toolkit itself.
export default {
  framework: {
    type: 'next-prerender',
  },
  commands: {
    build: 'npm run build',
    start: 'npm run start -- --hostname 127.0.0.1 --port 3111',
  },
  server: {
    origin: 'http://127.0.0.1:3111',
    startupTimeoutMs: 120_000,
  },
  routes: {
    exclude: ['/drafts/**'],
  },
};
