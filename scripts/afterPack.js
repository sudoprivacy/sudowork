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
 * Sign all binary files inside a .tgz archive (for macOS notarization)
 * @param {string} tgzPath - Path to the .tgz file
 * @param {string} identity - Code signing identity
 */
async function signBinariesInTgz(tgzPath, identity) {
  if (!fs.existsSync(tgzPath)) {
    console.log(`   ⚠️  ${tgzPath} not found, skipping signing`);
    return;
  }

  console.log(`\n🔐 Signing binaries in ${path.basename(tgzPath)}...`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudowork-sign-'));
  const extractedDir = path.join(tmpDir, 'extracted');

  try {
    // Extract the tgz
    fs.mkdirSync(extractedDir, { recursive: true });
    execSync(`tar -xzf "${tgzPath}" -C "${extractedDir}"`, { stdio: 'inherit' });

    // Find all binary files (.node, .dylib, .so, executables without extension)
    const binaryExtensions = ['.node', '.dylib', '.so'];
    const binaries = [];

    function findBinaries(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findBinaries(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (binaryExtensions.includes(ext)) {
            binaries.push(fullPath);
          }
        }
      }
    }

    findBinaries(extractedDir);

    if (binaries.length === 0) {
      console.log(`   ℹ️  No binaries found in ${path.basename(tgzPath)}`);
      return;
    }

    console.log(`   Found ${binaries.length} binaries to sign`);

    // Sign each binary
    for (const binary of binaries) {
      try {
        execSync(`codesign --sign "${identity}" --force --timestamp --options runtime "${binary}"`, {
          stdio: 'pipe',
        });
        console.log(`   ✓ Signed: ${path.basename(binary)}`);
      } catch (err) {
        console.warn(`   ⚠️  Failed to sign ${path.basename(binary)}: ${err.message}`);
      }
    }

    // Re-pack the tgz
    // Find the root directory inside extracted (usually the package name)
    const extractedContents = fs.readdirSync(extractedDir);
    let packRoot = extractedDir;
    if (extractedContents.length === 1 && fs.statSync(path.join(extractedDir, extractedContents[0])).isDirectory()) {
      packRoot = path.join(extractedDir, extractedContents[0]);
    }

    // Create new tgz
    const newTgzPath = tgzPath + '.new';
    execSync(`tar -czf "${newTgzPath}" -C "${path.dirname(packRoot)}" "${path.basename(packRoot)}"`, {
      stdio: 'inherit',
    });

    // Replace original
    fs.unlinkSync(tgzPath);
    fs.renameSync(newTgzPath, tgzPath);

    console.log(`   ✅ Re-packed ${path.basename(tgzPath)} with signed binaries`);
  } catch (err) {
    console.error(`   ❌ Error processing ${path.basename(tgzPath)}: ${err.message}`);
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

  // Determine resources directory based on platform
  // macOS: appOutDir/Sudowork.app/Contents/Resources
  // Windows/Linux: appOutDir/resources
  let resourcesDir;
  if (electronPlatformName === 'darwin') {
    const appName = packager?.appInfo?.productFilename || 'Sudowork';
    resourcesDir = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(appOutDir, 'resources');
  }

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

  // Sign binaries inside bundled .tgz files (for macOS notarization)
  // These are CLI tools bundled as compressed archives
  if (electronPlatformName === 'darwin' && process.env.CSC_NAME) {
    const tgzFiles = ['openclaw.tgz', 'claude-code.tgz'];
    const identity = process.env.CSC_NAME;

    for (const tgzFile of tgzFiles) {
      const tgzPath = path.join(resourcesDir, tgzFile);
      try {
        await signBinariesInTgz(tgzPath, identity);
      } catch (err) {
        console.warn(`   ⚠️  Failed to sign binaries in ${tgzFile}: ${err.message}`);
        // Don't throw - allow build to continue
      }
    }
  }
};
