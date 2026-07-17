import { createVisualConfig } from '@thisdot/visual-regression';

export default createVisualConfig({
  colorScheme: 'light',
  port: 3217,
  startCommand: 'npm run start -- --hostname 127.0.0.1 --port 3217',
  exclude: ['/excluded'],
});
