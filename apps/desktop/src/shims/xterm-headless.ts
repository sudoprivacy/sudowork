// Use a path that won't be caught by the @xterm/headless alias — a deliberate
// CommonJS require so the bundler alias does not rewrite it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const xtermHeadless = require('@xterm/headless/lib-headless/xterm-headless.js');
const Terminal = xtermHeadless.Terminal;

export { Terminal };
export default { Terminal };
