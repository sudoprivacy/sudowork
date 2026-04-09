const { Arch } = require('builder-util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { normalizeArch, rebuildSingleModule, verifyModuleBinary, getModulesToRebuild } = require('./rebuildNativeModules');

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

/**
 * Files to remove from extracted archives before repacking.
 * These cannot be notarized because they:
 *  - were compiled against a pre-10.9 SDK (Apple hard-rejects them), OR
 *  - are foreign-architecture binaries that have no use in the bundle.
 *
 * Each entry is a substring that must appear in the file's path relative to
 * the extraction root. Matching is case-insensitive on all platforms.
 */
const ARCHIVE_CLEANUP_SUBSTRINGS = [
  // SpeechRecognition Python package: pre-built macOS FLAC encoder.
  // Compiled with old SDK, x86_64-only — fails notarization on arm64 builds.
  // The binary is a helper for microphone recording; not required by Nexus server.
  'speech_recognition/flac-mac',
  'speech_recognition\\flac-mac', // Windows path separator variant
];

/**
 * Remove known-problematic files from a directory tree before repacking.
 * Returns the number of files deleted.
 * @param {string} dir - Root of the extracted archive
 * @returns {number}
 */
function removeUnnotarizableFiles(dir) {
  let removed = 0;

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        // Build a forward-slash relative path for consistent matching
        const rel = fullPath.replace(dir, '').replace(/\\/g, '/').toLowerCase();
        for (const needle of ARCHIVE_CLEANUP_SUBSTRINGS) {
          if (rel.includes(needle.replace(/\\/g, '/').toLowerCase())) {
            try {
              fs.unlinkSync(fullPath);
              console.log(`   🗑  Removed un-notarizable file: ${rel}`);
              removed++;
            } catch (err) {
              console.warn(`   ⚠️  Could not remove ${rel}: ${err.message}`);
            }
            break;
          }
        }
      }
    }
  }

  walk(dir);
  return removed;
}

// NOTE: fixFrameworkStructure / _ensureFrameworkInfoPlist have been intentionally
// removed.  PyInstaller creates non-standard .framework bundles that cannot be
// made Apple-compliant reliably (EEXIST on existing symlinks, missing Info.plist
// still triggers "bundle format is ambiguous").  Instead we sign every Mach-O
// binary *inside* the .framework individually and never attempt to codesign the
// .framework directory itself.  The outer .app signature covers the bundle.

/**
 * Sign all binary files recursively in a directory
 * @param {string} dir - Directory to search for binaries
 * @param {string} identity - Code signing identity
 * @param {string|null} entitlementsPath - Optional entitlements plist path (required for JIT-capable binaries like Node.js)
 * @returns {number} Number of binaries signed
 */
function signBinariesInDir(dir, identity, entitlementsPath = null) {
  // Extensions that are definitely Mach-O/native binaries — always sign
  const nativeBinaryExtensions = new Set(['.node', '.dylib', '.so']);

  // Extensions that are definitely NOT binaries — skip Mach-O check for performance.
  // NOTE: version-suffixed executables like wish8.6, tclsh8.6 have ext '.6' which is
  // NOT in this list, so they fall through to the Mach-O byte check below.
  const skipExtensions = new Set([
    '.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.html', '.css',
    '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.plist',
    '.py', '.rb', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
    '.h', '.c', '.cpp', '.cc', '.m', '.swift', '.java', '.go', '.rs',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.icns', '.webp',
    '.mp3', '.mp4', '.wav', '.ogg', '.flac',
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.tgz', '.7z',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.lock', '.log', '.map', '.wasm', '.d', '.a',
    '.patch', '.diff', '.nsh', '.nsi',
  ]);

  // Read exactly 4 bytes from a file to check Mach-O magic numbers.
  // Using openSync/readSync instead of readFileSync to avoid reading the whole file.
  function isMachOBinary(filePath) {
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
      if (bytesRead < 4) return false;
      // Mach-O magic numbers:
      // 64-bit LE:  CF FA ED FE
      // 32-bit LE:  CE FA ED FE
      // Fat/Universal (BE): CA FE BA BE
      return (
        (buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) ||
        (buf[0] === 0xce && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) ||
        (buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe)
      );
    } catch {
      return false;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  // ── 1. Collect .framework bundles ──────────────────────────────────────
  // .framework dirs need special handling: we sign every Mach-O binary inside
  // them individually, but never codesign the .framework directory itself
  // (PyInstaller's non-standard structure causes "bundle format is ambiguous").
  const frameworkBundles = [];
  function findFrameworks(currentDir) {
    let entries;
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.framework')) {
          frameworkBundles.push(fullPath);
          // Don't recurse — contents will be signed as part of the bundle
        } else {
          findFrameworks(fullPath);
        }
      }
    }
  }
  findFrameworks(dir);

  // ── 2. Find individual Mach-O binaries (skip .framework dirs) ────────
  const binaries = [];

  function findBinaries(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip symlinks — they point to files signed through their primary location.
      // e.g. PyInstaller may place a symlink _internal/Python → Python.framework/Versions/A/Python;
      // codesign follows the symlink, sees .framework in the resolved path, and fails with
      // "bundle format is ambiguous".  The real binary is signed as part of the framework bundle.
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip .framework dirs — inner binaries are signed in step 4
        if (entry.name.endsWith('.framework')) continue;
        findBinaries(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Always include known native binary extensions
        if (nativeBinaryExtensions.has(ext)) {
          binaries.push(fullPath);
          continue;
        }
        // Skip known non-binary extensions for performance
        if (skipExtensions.has(ext)) {
          continue;
        }
        // For everything else — including extensionless files AND versioned executables
        // like wish8.6 (ext='.6'), tclsh8.6, python3.11, etc. — check Mach-O magic bytes.
        if (isMachOBinary(fullPath)) {
          binaries.push(fullPath);
        }
      }
    }
  }

  findBinaries(dir);

  if (binaries.length === 0 && frameworkBundles.length === 0) {
    return 0;
  }

  if (binaries.length > 0) {
    console.log(`   Found ${binaries.length} binaries to sign in ${path.basename(dir)}`);
  }
  if (frameworkBundles.length > 0) {
    console.log(`   Found ${frameworkBundles.length} .framework bundle(s) to sign`);
  }

  // ── 3. Sign individual binaries ──────────────────────────────────────
  let signedCount = 0;
  const failedBinaries = [];

  for (const binary of binaries) {
    try {
      // Strip any existing signature first (e.g. conda-forge Team ID) so that
      // codesign --force starts from a clean slate. Without this, some dylibs
      // can fail re-signing and retain their original Team ID, causing a
      // "different Team IDs" dlopen error at runtime on the user's machine.
      try {
        execSync(`codesign --remove-signature "${binary}"`, { stdio: 'pipe' });
      } catch {
        // Binary may have no signature — that is fine, continue to sign.
      }
      const entitlementsFlag = entitlementsPath ? `--entitlements "${entitlementsPath}"` : '';
      execSync(`codesign --sign "${identity}" --force --timestamp --options runtime ${entitlementsFlag} "${binary}"`, {
        stdio: 'pipe',
      });
      console.log(`   ✓ Signed: ${path.basename(binary)}`);
      signedCount++;
    } catch (err) {
      const msg = err.stderr ? err.stderr.toString().trim() : err.message;
      console.warn(`   ⚠️  Failed to sign ${path.basename(binary)}: ${msg}`);
      failedBinaries.push(path.basename(binary));
    }
  }

  // ── 4. Sign Mach-O binaries inside .framework bundles ─────────────────
  // PyInstaller creates non-standard .framework bundles that macOS codesign
  // cannot classify ("bundle format is ambiguous — could be app or framework").
  //
  // Strategy: sign every Mach-O binary INSIDE the framework individually.
  // ❌ Do NOT sign the .framework directory itself — it will always fail.
  // ❌ Do NOT attempt to "fix" the framework structure — it causes EEXIST
  //    errors and still doesn't make codesign happy.
  // ✅ The outer .app signature (electron-builder) covers everything.
  for (const fwPath of frameworkBundles) {
    let fwSignedCount = 0;

    // Walk the ENTIRE .framework directory tree to find all Mach-O binaries.
    // This handles both flat (Python.framework/Python) and structured
    // (Python.framework/Versions/3.12/Python) layouts from PyInstaller.
    //
    // IMPORTANT: Use fs.lstatSync() for symlink detection instead of
    // Dirent.isSymbolicLink(), which can be unreliable on macOS APFS.
    // We also collect symlinks so we can replace them with copies of
    // the signed binary after signing — Apple notarization validates
    // Python.framework/Python (a symlink) and rejects it if the path
    // goes through .framework without a proper bundle signature.
    const innerBinaries = [];
    const symlinkEntries = [];
    const walkFramework = (currentDir) => {
      let entries;
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        // Use lstatSync for reliable symlink detection on macOS
        let stat;
        try { stat = fs.lstatSync(fullPath); } catch { continue; }
        if (stat.isSymbolicLink()) {
          symlinkEntries.push(fullPath);
          continue;
        }
        if (stat.isDirectory()) {
          walkFramework(fullPath);
        } else if (stat.isFile() && isMachOBinary(fullPath)) {
          innerBinaries.push(fullPath);
        }
      }
    };
    walkFramework(fwPath);

    // ── 4a. Sign real (non-symlink) Mach-O binaries inside .framework ──
    for (const innerBin of innerBinaries) {
      try {
        // Remove any existing signature first (clean slate — prevents Team ID mismatch)
        try { execSync(`codesign --remove-signature "${innerBin}"`, { stdio: 'pipe' }); } catch { /* no existing sig */ }
        const entitlementsFlag = entitlementsPath ? `--entitlements "${entitlementsPath}"` : '';
        execSync(`codesign --sign "${identity}" --force --timestamp --options runtime ${entitlementsFlag} "${innerBin}"`, {
          stdio: 'pipe',
        });
        console.log(`   ✓ Signed (framework): ${path.relative(fwPath, innerBin)}`);
        signedCount++;
        fwSignedCount++;
      } catch (innerErr) {
        const innerMsg = innerErr.stderr ? innerErr.stderr.toString().trim() : innerErr.message;
        console.warn(`   ⚠️  Failed to sign framework binary ${path.relative(fwPath, innerBin)}: ${innerMsg}`);
        failedBinaries.push(`${path.basename(fwPath)}/${path.relative(fwPath, innerBin)}`);
      }
    }

    // ── 4b. Replace symlinks with copies of the signed binary ──────────
    // Apple notarization follows symlinks inside .framework bundles and
    // validates them according to framework bundle rules.  A symlink like
    // Python.framework/Python → Versions/Current/Python causes:
    //   "The signature of the binary is invalid."
    // because the path traverses .framework without a proper bundle seal.
    //
    // Fix: replace each symlink-to-Mach-O with a copy of the signed real
    // binary.  This way Apple sees a real signed file at every path.
    let replacedSymlinks = 0;
    for (const symlinkPath of symlinkEntries) {
      try {
        const realPath = fs.realpathSync(symlinkPath);
        // Only replace symlinks that point to Mach-O binaries
        if (isMachOBinary(realPath)) {
          fs.unlinkSync(symlinkPath);       // Remove the symlink
          fs.copyFileSync(realPath, symlinkPath);  // Copy the signed binary
          console.log(`   ✓ Replaced symlink with signed copy: ${path.relative(fwPath, symlinkPath)}`);
          replacedSymlinks++;
        }
      } catch {
        // Symlink target doesn't exist, is a directory, or can't be read — skip
      }
    }

    if (fwSignedCount > 0 || replacedSymlinks > 0) {
      console.log(`   ✓ Framework ${path.basename(fwPath)}: signed ${fwSignedCount} binary(ies), replaced ${replacedSymlinks} symlink(s)`);
    } else {
      console.warn(`   ⚠️  Framework ${path.basename(fwPath)}: no Mach-O binaries found inside`);
    }
  }

  if (failedBinaries.length > 0) {
    console.warn(`   ⚠️  ${failedBinaries.length} binary/binaries could NOT be signed (Team ID mismatch risk):`);
    for (const name of failedBinaries) {
      console.warn(`        - ${name}`);
    }
  }

  return signedCount;
}

/**
 * Sign all binary files inside a .tgz archive (for macOS notarization)
 * Handles nested .tar files (e.g., openclaw.tgz contains openclaw.tar)
 * @param {string} archivePath - Path to the archive file
 * @param {string} identity - Code signing identity
 * @param {boolean} isNested - Whether this is a nested archive call
 * @param {string|null} entitlementsPath - Optional entitlements plist path (pass for Node.js runtime archive)
 */
async function signBinariesInArchive(archivePath, identity, isNested = false, entitlementsPath = null) {
  if (!fs.existsSync(archivePath)) {
    console.log(`   ⚠️  ${archivePath} not found, skipping signing`);
    return;
  }

  const archiveName = path.basename(archivePath);
  const archiveType = archivePath.endsWith('.tgz') || archivePath.endsWith('.tar.gz') ? 'tgz' : 'tar';
  const extractFlag = archiveType === 'tgz' ? '-xzf' : '-xf';

  console.log(`\n🔐 Processing ${archiveName}...`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-sign-'));
  const extractedDir = path.join(tmpDir, 'extracted');

  try {
    // Extract the archive
    fs.mkdirSync(extractedDir, { recursive: true });
    console.log(`   📂 Extracting to: ${extractedDir}`);

    // On macOS, tar -xzf for .tar.gz files might create a .tar intermediate file
    // Use gunzip + tar to ensure proper extraction
    if (archiveType === 'tgz' && archivePath.endsWith('.tar.gz')) {
      // For .tar.gz files, use pipe to avoid creating intermediate .tar file
      // macOS BSD tar can behave differently than GNU tar
      try {
        execSync(`gunzip -c "${archivePath}" | tar -xf - -C "${extractedDir}"`, { stdio: 'inherit', shell: '/bin/bash' });
      } catch (pipeErr) {
        // Fallback to standard tar -xzf if pipe fails
        console.log(`   ⚠️  Pipe extraction failed, trying standard tar...`);
        execSync(`tar -xzf "${archivePath}" -C "${extractedDir}"`, { stdio: 'inherit' });
      }
    } else {
      execSync(`tar ${extractFlag} "${archivePath}" -C "${extractedDir}"`, { stdio: 'inherit' });
    }

    // Debug: show what was extracted
    const extractedItems = fs.readdirSync(extractedDir);
    console.log(`   📁 Extracted ${extractedItems.length} items at root: ${extractedItems.slice(0, 10).join(', ')}${extractedItems.length > 10 ? '...' : ''}`);

    // Check if a .tar file was created at root (macOS tar quirk)
    const tarAtRoot = extractedItems.filter(f => f.endsWith('.tar'));
    if (tarAtRoot.length > 0) {
      console.log(`   ⚠️  Found .tar file(s) at root, extracting them: ${tarAtRoot.join(', ')}`);
      for (const tarFile of tarAtRoot) {
        const tarPath = path.join(extractedDir, tarFile);
        try {
          // Extract the .tar file into the same directory
          execSync(`tar -xf "${tarPath}" -C "${extractedDir}"`, { stdio: 'inherit' });
          // Remove the .tar file after extraction
          fs.unlinkSync(tarPath);
          console.log(`   ✓ Extracted and removed: ${tarFile}`);
        } catch (extractErr) {
          console.error(`   ⚠️  Failed to extract ${tarFile}: ${extractErr.message}`);
        }
      }
      // Refresh the list
      const newItems = fs.readdirSync(extractedDir);
      console.log(`   📁 After .tar extraction: ${newItems.length} items`);
    }

    // Find and process nested .tar files first
    const nestedTarFiles = [];
    function findNestedTarFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findNestedTarFiles(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.tar') || entry.name.endsWith('.tgz') || entry.name.endsWith('.tar.gz'))) {
          nestedTarFiles.push(fullPath);
        }
      }
    }
    findNestedTarFiles(extractedDir);
    console.log(`   📦 Found ${nestedTarFiles.length} nested archive(s) to process`);

    // Process nested tar files
    for (const nestedTar of nestedTarFiles) {
      console.log(`   📦 Found nested archive: ${path.basename(nestedTar)}`);
      const nestedTmpDir = path.dirname(nestedTar);
      const nestedExtractedDir = path.join(nestedTmpDir, 'nested_extracted');

      try {
        fs.mkdirSync(nestedExtractedDir, { recursive: true });
        // .tgz and .tar.gz need -xzf (gzip), .tar needs -xf
        const nestedFlag = (nestedTar.endsWith('.tgz') || nestedTar.endsWith('.tar.gz')) ? '-xzf' : '-xf';
        execSync(`tar ${nestedFlag} "${nestedTar}" -C "${nestedExtractedDir}"`, { stdio: 'inherit' });

        // Sign binaries in nested content (propagate entitlements for Node archives)
        const nestedSigned = signBinariesInDir(nestedExtractedDir, identity, entitlementsPath);
        console.log(`   Signed ${nestedSigned} binaries in nested archive`);

        // Re-pack the nested tar (preserve compression format)
        const nestedContents = fs.readdirSync(nestedExtractedDir);
        const newNestedTar = nestedTar + '.new';
        // Use -czf for .tgz and .tar.gz, -cf for .tar
        const nestedPackFlag = (nestedTar.endsWith('.tgz') || nestedTar.endsWith('.tar.gz')) ? '-czf' : '-cf';
        if (nestedContents.length === 1 && fs.statSync(path.join(nestedExtractedDir, nestedContents[0])).isDirectory()) {
          const singleItem = nestedContents[0];
          execSync(`tar ${nestedPackFlag} "${newNestedTar}" -C "${nestedExtractedDir}" "${singleItem}"`, {
            stdio: 'inherit',
          });
        } else {
          execSync(`tar ${nestedPackFlag} "${newNestedTar}" -C "${nestedExtractedDir}" .`, {
            stdio: 'inherit',
          });
        }

        // Replace original nested tar
        fs.unlinkSync(nestedTar);
        fs.renameSync(newNestedTar, nestedTar);
        fs.rmSync(nestedExtractedDir, { recursive: true, force: true });
        console.log(`   ✅ Re-packed nested archive: ${path.basename(nestedTar)}`);
      } catch (err) {
        console.error(`   ❌ Error processing nested archive: ${err.message}`);
      }
    }

    // Remove files that cannot pass notarization (old SDK, wrong arch, etc.)
    // This must happen BEFORE signing so we don't waste time signing doomed files.
    const removedCount = removeUnnotarizableFiles(extractedDir);
    if (removedCount > 0) {
      console.log(`   🗑  Removed ${removedCount} un-notarizable file(s) from ${archiveName}`);
    }

    // Sign binaries in the main extracted content
    const signedCount = signBinariesInDir(extractedDir, identity, entitlementsPath);
    console.log(`   Signed ${signedCount} binaries total`);

    // Re-pack the main archive
    // Original structure preservation:
    // - If original tar had a single root directory, preserve it
    // - If original tar had multiple items at root (bin/, lib/, VERSION, etc.), pack them directly
    const extractedContents = fs.readdirSync(extractedDir);
    console.log(`   📁 Root contents (${extractedContents.length} items): ${extractedContents.slice(0, 10).join(', ')}${extractedContents.length > 10 ? '...' : ''}`);

    // Check for unexpected .tar files at root
    const unexpectedTarFiles = extractedContents.filter(f => f.endsWith('.tar'));
    if (unexpectedTarFiles.length > 0) {
      console.error(`   ⚠️  WARNING: Found unexpected .tar files at root: ${unexpectedTarFiles.join(', ')}`);
    }

    const packFlag = archiveType === 'tgz' ? '-czf' : '-cf';
    const newArchivePath = archivePath + '.new';

    if (extractedContents.length === 1 && fs.statSync(path.join(extractedDir, extractedContents[0])).isDirectory()) {
      // Single root directory case: pack that directory's name as root
      const singleDir = extractedContents[0];
      execSync(`tar ${packFlag} "${newArchivePath}" -C "${extractedDir}" "${singleDir}"`, {
        stdio: 'inherit',
      });
    } else {
      // Multiple items at root: pack contents directly (not the "extracted" directory itself)
      execSync(`tar ${packFlag} "${newArchivePath}" -C "${extractedDir}" .`, {
        stdio: 'inherit',
      });
    }

    // Replace original
    fs.unlinkSync(archivePath);
    fs.renameSync(newArchivePath, archivePath);

    console.log(`   ✅ Re-packed ${archiveName} with signed binaries`);

    // Verify no unexpected .tar files were created
    const verifyDir = path.join(tmpDir, 'verify');
    try {
      fs.mkdirSync(verifyDir, { recursive: true });
      execSync(`tar -xzf "${archivePath}" -C "${verifyDir}"`, { stdio: 'pipe' });
      const verifyContents = fs.readdirSync(verifyDir);
      const tarAtRoot = verifyContents.filter(f => f.endsWith('.tar'));
      if (tarAtRoot.length > 0) {
        console.error(`   ❌ ERROR: Unexpected .tar file(s) created at root: ${tarAtRoot.join(', ')}`);
      } else {
        console.log(`   ✓ Verified: No unexpected .tar files at root`);
      }
    } catch (verifyErr) {
      console.warn(`   ⚠️  Could not verify archive: ${verifyErr.message}`);
    }
  } catch (err) {
    console.error(`   ❌ Error processing ${archiveName}: ${err.message}`);
    throw err;
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);

  // Determine resources directory based on platform (needed for signing even if rebuild is skipped)
  // macOS: appOutDir/Sudowork.app/Contents/Resources
  // Windows/Linux: appOutDir/resources
  let resourcesDir;
  if (electronPlatformName === 'darwin') {
    const appName = packager?.appInfo?.productFilename || 'Sudowork';
    resourcesDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(appOutDir, 'resources');
  }

  // Sign binaries inside bundled .tgz files (for macOS notarization)
  // This must run BEFORE the early return, as signing is always needed on macOS
  if (electronPlatformName === 'darwin' && process.env.CSC_NAME) {
    const identity = process.env.CSC_NAME;

    // Sign bundled bdpan installer binary directly (it's a plain binary, not an archive)
    const bdpanBinary = path.join(resourcesDir, `bdpan-installer-darwin-${targetArch}`);
    if (fs.existsSync(bdpanBinary)) {
      console.log(`\n🔐 Signing bdpan installer binary...`);
      try {
        execSync(`codesign --sign "${identity}" --force --timestamp --options runtime "${bdpanBinary}"`, { stdio: 'pipe' });
        console.log(`   ✓ Signed: ${path.basename(bdpanBinary)}`);
      } catch (err) {
        console.warn(`   ⚠️  Failed to sign bdpan installer: ${err.message}`);
      }
    }

    // Sign versioned nexus archives by unpacking and re-signing their bundled binaries.
    // Current macOS resources ship Nexus as .tar.gz/.tgz archives, not plain executables.
    const nexusArchives = [];
    try {
      nexusArchives.push(
        ...fs.readdirSync(resourcesDir).filter(f => /^v[\d.]+-nexus-cluster-.*\.(?:tar\.gz|tgz|tar)$/.test(f)),
      );
    } catch {
      // Resources dir not readable — nexus archives will be skipped
    }

    // Fixed name archives
    const fixedArchives = ['openclaw.tgz', 'claude-code.tgz'];

    // Node runtime has architecture-specific name (e.g., node-darwin-arm64.tar.gz)
    const nodeArchive = `node-darwin-${targetArch}.tar.gz`;

    const archivesToSign = [...fixedArchives, nodeArchive, ...nexusArchives];
    // Node.js binary needs JIT/memory entitlements so V8 can run under Hardened Runtime.
    // Without these, macOS blocks JIT compilation and Node crashes with SIGTRAP (trace trap).
    const entitlementsPath = path.join(__dirname, '..', 'entitlements.plist');

    for (const archiveFile of archivesToSign) {
      const archivePath = path.join(resourcesDir, archiveFile);
      // Only the Node runtime archive contains a JIT-capable executable — pass entitlements for it only.
      const useEntitlements = archiveFile === nodeArchive ? entitlementsPath : null;
      try {
        await signBinariesInArchive(archivePath, identity, false, useEntitlements);
      } catch (err) {
        console.warn(`   ⚠️  Failed to sign binaries in ${archiveFile}: ${err.message}`);
        // Don't throw - allow build to continue
      }
    }
  }

  const isCrossCompile = buildArch !== targetArch;
  const forceRebuild = process.env.FORCE_NATIVE_REBUILD === 'true';
  const needsSameArchRebuild = electronPlatformName === 'win32'; // 只有 Windows 需要同架构重建以匹配 Electron ABI | Only Windows needs same-arch rebuild to match Electron ABI
  // Linux 使用预编译二进制，避免 GLIBC 版本依赖 | Linux uses prebuilt binaries which are GLIBC-independent

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
    console.log(`   ✓ Same architecture, rebuild skipped (set FORCE_NATIVE_REBUILD=true to override)\n`);
    return;
  }

  // Note: Previously there was an optimization to skip macOS cross-compilation,
  // but this caused incorrect architecture binaries (arm64) to be included in x64 builds.
  // Now we always rebuild native modules for cross-compilation to ensure correctness.
  // The rebuild process uses prebuild-install first (fast), falling back to source compilation only when needed.

  if (isCrossCompile) {
    console.log(`   ⚠️  Cross-compilation detected (${buildArch} → ${targetArch}), will rebuild native modules`);
    if (electronPlatformName === 'darwin') {
      console.log(`   💡 Using prebuild-install for faster cross-architecture build`);
    }
  } else if (needsSameArchRebuild || forceRebuild) {
    console.log(`   ℹ️  Rebuilding native modules for platform requirements (force=${forceRebuild})`);
  }

  console.log(`\n🔧 Checking native modules (${electronPlatformName}-${targetArch})...`);
  console.log(`   appOutDir: ${appOutDir}`);

  const electronVersion =
    packager?.info?.electronVersion ??
    packager?.config?.electronVersion ??
    require('../package.json').devDependencies?.electron?.replace(/^\D*/, '');

  // Debug: check what's in resources directory
  console.log(`   Checking resources directory: ${resourcesDir}`);
  if (fs.existsSync(resourcesDir)) {
    const resourcesContents = fs.readdirSync(resourcesDir);
    console.log(`   Contents: ${resourcesContents.join(', ')}`);

    // Check if app.asar.unpacked exists
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const unpackedContents = fs.readdirSync(unpackedDir);
      console.log(`   app.asar.unpacked contents: ${unpackedContents.join(', ')}`);

      // Check node_modules
      const nodeModulesDir = path.join(unpackedDir, 'node_modules');
      if (fs.existsSync(nodeModulesDir)) {
        const modulesContents = fs.readdirSync(nodeModulesDir);
        console.log(`   node_modules contents: ${modulesContents.slice(0, 10).join(', ')}...`);
      } else {
        console.warn(`   ⚠️  node_modules not found in app.asar.unpacked`);
      }
    } else {
      console.warn(`   ⚠️  app.asar.unpacked not found`);
    }
  } else {
    console.warn(`⚠️  resources directory not found: ${resourcesDir}`);
    return;
  }

  const nodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

  // Modules that need to be rebuilt for cross-compilation
  // Use platform-specific module list (Windows skips node-pty due to cross-compilation issues)
  const modulesToRebuild = getModulesToRebuild(electronPlatformName);
  console.log(`   Modules to rebuild: ${modulesToRebuild.join(', ')}`);

  // For cross-compilation, clean up build artifacts from the wrong architecture
  // This prevents node-gyp-build from loading incorrect binaries
  if (isCrossCompile) {
    console.log(`\n🧹 Cleaning up wrong-architecture build artifacts...`);
    for (const moduleName of modulesToRebuild) {
      const moduleRoot = path.join(nodeModulesDir, moduleName);
      if (!fs.existsSync(moduleRoot)) continue;

      // Remove build/ directory (contains wrong-arch compiled binaries)
      const buildDir = path.join(moduleRoot, 'build');
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/build/`);
      }

      // Remove bin/ directory (might contain wrong-arch binaries)
      const binDir = path.join(moduleRoot, 'bin');
      if (fs.existsSync(binDir)) {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/bin/`);
      }
    }

    // Also clean up architecture-specific packages that shouldn't be included
    // Remove packages for the opposite architecture of the target
    const wrongArchSuffix = targetArch === 'arm64' ? 'x64' : 'arm64';
    console.log(`\n🧹 Removing ${wrongArchSuffix}-specific optional dependencies (target: ${targetArch})...`);

    if (fs.existsSync(nodeModulesDir)) {
      const allModules = fs.readdirSync(nodeModulesDir);
      for (const module of allModules) {
        const modulePath = path.join(nodeModulesDir, module);

        // Handle scoped packages (e.g., @lydell, @napi-rs)
        if (module.startsWith('@') && fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          const scopedPackages = fs.readdirSync(modulePath);
          for (const pkg of scopedPackages) {
            if (pkg.includes(`-${wrongArchSuffix}`) || pkg.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
              const pkgPath = path.join(modulePath, pkg);
              if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                fs.rmSync(pkgPath, { recursive: true, force: true });
                console.log(`   ✓ Removed ${module}/${pkg}`);
              }
            }
          }
        }
        // Handle regular packages
        else if (module.includes(`-${wrongArchSuffix}`) || module.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
          if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            fs.rmSync(modulePath, { recursive: true, force: true });
            console.log(`   ✓ Removed ${module}`);
          }
        }
      }
    }
  }

  const failedModules = [];

  for (const moduleName of modulesToRebuild) {
    const moduleRoot = path.join(nodeModulesDir, moduleName);

    if (!fs.existsSync(moduleRoot)) {
      console.warn(`   ⚠️  ${moduleName} not found, skipping`);
      continue;
    }

    console.log(`   ✓ Found ${moduleName}, rebuilding for ${targetArch}...`);

    // For Windows, prefer prebuild-install first (faster and more reliable in CI)
    // electron-rebuild can hang on "Searching dependency tree" in some CI environments
    // prebuild-install will fall back to electron-rebuild internally if no prebuilt binary exists
    const forceRebuildFromSource = false; // Always try prebuild-install first

    const success = rebuildSingleModule({
      moduleName,
      moduleRoot,
      platform: electronPlatformName,
      arch: targetArch,
      electronVersion,
      projectRoot: path.resolve(__dirname, '..'),
      buildArch: buildArch, // Pass build architecture for cross-compile detection
      forceRebuild: forceRebuildFromSource, // Always try prebuild-install first, fallback to rebuild
    });

    if (success) {
      console.log(`     ✓ Rebuild completed`);
    } else {
      console.error(`     ✗ Rebuild failed`);
      failedModules.push(moduleName);
      continue;
    }

    const verified = verifyModuleBinary(moduleRoot, moduleName);
    if (verified) {
      console.log(`     ✓ Binary verification passed`);
    } else {
      console.error(`     ✗ Binary verification failed`);
      failedModules.push(moduleName);
    }

    console.log(''); // Empty line between modules
  }

  if (failedModules.length > 0) {
    throw new Error(`Failed to rebuild modules for ${electronPlatformName}-${targetArch}: ${failedModules.join(', ')}`);
  }

  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);
};
