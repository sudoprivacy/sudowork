/**
 * This script is for reference only. Nexus is now downloaded dynamically at runtime.
 * The URLs defined here are used by the DynamicNexusService at runtime.
 *
 * Previously:
 * Downloads the pre-built Nexus conda environment (nexus.tar.gz) into resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 *
 * Usage:
 *   node scripts/download-nexus.js [--platform <darwin|linux|win32>] [--arch <arm64|x64>] [--force]
 *
 * When --platform/--arch are omitted, the current process.platform / process.arch are used.
 * Use --force to re-download even if the file already exists.
 */

// ---------------------------------------------------------------------------
// URL map: platform-arch → download URL
// Add / update entries here when new builds are available.
// NOTE: These URLs are now used by DynamicNexusService at runtime.
// ---------------------------------------------------------------------------
const NEXUS_URLS = {
  'darwin-arm64': 'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/mac-arm-nexus.tar.gz',
  'darwin-x64':   'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/mac-x64-nexus.tar.gz', // Placeholder - needs real URL
  'linux-x64':    'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/linux-x64-nexus.tar.gz', // Placeholder - needs real URL
  'win32-x64':    'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/win-x64-nexus.tar.gz', // Placeholder - needs real URL
  // Windows uses PyInstaller binary, no conda env needed
};

console.log('Note: This script is for reference only. Nexus is now downloaded dynamically at runtime.');
console.log('The URLs are now managed by DynamicNexusService.');
console.log('Available URLs:');
for (const [key, url] of Object.entries(NEXUS_URLS)) {
  console.log(`  ${key}: ${url}`);
}
