import { createCodemodeExtension, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import registerModel from '../../../../test-support/terminal/model-provider.js';

export default function (pi: ExtensionAPI) {
  createCodemodeExtension({ models: false })(pi);
  pi.on('session_start', () => {
    pi.setActiveTools([...new Set([...pi.getActiveTools(), 'codemode'])]);
  });
  registerModel(pi);
}
