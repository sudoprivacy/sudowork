const { execSync } = require('child_process');
const net = require('net');

// Remove ELECTRON_RUN_AS_NODE completely from env
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

/**
 * Find a port that Node.js can actually bind on this system.
 * Windows WinNAT/Hyper-V can reserve ports at the OS level, causing
 * EACCES even when the port appears free. This probes by actually
 * attempting to listen.
 */
function findAvailablePort(preferred, maxAttempts = 20) {
  const { execSync } = require('child_process');
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    try {
      // Use a child process to truly test if the port is bindable.
      // server.listen() is async in the current process and may not throw synchronously.
      execSync(
        `node -e "const s=require('net').createServer();s.listen(${port},'127.0.0.1',()=>{s.close();process.exit(0)});s.on('error',()=>process.exit(1))"`,
        { timeout: 2000, stdio: 'ignore' }
      );
      return port;
    } catch {
      // Port unavailable (EACCES or EADDRINUSE), try next
    }
  }
  throw new Error(`No available port found in range ${preferred}-${preferred + maxAttempts - 1}`);
}

// Try preferred port first, then fallback to alternative ranges
const preferredPort = 5173;
let actualPort;
try {
  actualPort = findAvailablePort(preferredPort, 30);
} catch {
  // 5173-5202 all blocked (common on Windows with Hyper-V), try 5500+
  actualPort = findAvailablePort(5500, 20);
}

if (actualPort !== preferredPort) {
  console.log(`Port ${preferredPort} unavailable (Windows port reservation), using ${actualPort}`);
}
// Override Vite's configured port via env var
cleanEnv.VITE_DEV_SERVER_PORT = String(actualPort);
// Force Node to resolve 'localhost' as IPv4 127.0.0.1 first — prevents EACCES
// on Windows where IPv6 ::1 port reservations can block binding
cleanEnv.NODE_OPTIONS = (cleanEnv.NODE_OPTIONS || '') + ' --dns-result-order=ipv4first';

console.log(`Launching electron-vite dev (renderer port: ${actualPort})...`);

try {
  execSync('npx electron-vite dev', {
    stdio: 'inherit',
    env: cleanEnv,
    cwd: __dirname + '/..',
  });
} catch (e) {
  process.exit(e.status || 1);
}
