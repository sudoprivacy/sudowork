const { execSync } = require('child_process');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Lazy-load notarize because @electron/notarize is ESM-only
  const { notarize } = await import('@electron/notarize');

  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.id;
  const appPath = `${appOutDir}/${appName}.app`;

  // Check if app is actually signed before attempting notarization
  try {
    execSync(`codesign --verify --verbose "${appPath}"`, { stdio: 'pipe' });
    console.log(`App ${appName} is properly code signed`);
  } catch (error) {
    console.log(`App ${appName} is not code signed, applying ad-hoc signature...`);
    try {
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
      console.log(`Ad-hoc signature applied successfully to ${appName}`);
    } catch (adHocError) {
      console.error('Ad-hoc signing failed:', adHocError.message);
    }
    return;
  }

  // Skip notarization if credentials are not provided
  if (!process.env.appleId || !process.env.appleIdPassword) {
    console.log('Skipping notarization - missing Apple ID credentials');
    return;
  }

  console.log(`Starting notarization for ${appName} (${appBundleId})...`);

  // Retry with exponential backoff for transient network errors
  const maxRetries = 5;
  const baseDelay = 30000; // 30 seconds
  const notarizeTimeout = 300000; // 5 minutes per attempt

  // Wrap notarize in a timeout promise
  const notarizeWithTimeout = (options) =>
    Promise.race([
      notarize(options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Notarization timed out after 5 minutes')), notarizeTimeout)
      ),
    ]);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await notarizeWithTimeout({
        tool: 'notarytool',
        appBundleId,
        appPath: appPath,
        appleId: process.env.appleId,
        appleIdPassword: process.env.appleIdPassword,
        teamId: process.env.teamId,
      });
      console.log('Notarization completed successfully');
      break;
    } catch (error) {
      const isNetworkError = error.message?.includes('timed out') ||
                             error.message?.includes('NSURLErrorDomain') ||
                             error.message?.includes('Notarization timed out') ||
                             error.code === -1001;

      if (isNetworkError && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Notarization attempt ${attempt} failed (network error): ${error.message}`);
        console.log(`Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('Notarization failed:', error);
        throw error;
      }
    }
  }
};
