const { execSync } = require('child_process');

// Remove ELECTRON_RUN_AS_NODE completely from env
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

console.log('Launching electron-vite dev with clean env...');
console.log('ELECTRON_RUN_AS_NODE removed:', !('ELECTRON_RUN_AS_NODE' in cleanEnv));

try {
  execSync('npx electron-vite dev', {
    stdio: 'inherit',
    env: cleanEnv,
    cwd: __dirname + '/..',
  });
} catch (e) {
  process.exit(e.status || 1);
}
