// ESM loader hooks to mock Electron for testing
// Used with: node --import ./src/test-hooks.js

import { register } from 'node:module';

register('./test-loader.js', import.meta.url);
