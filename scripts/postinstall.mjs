// 1. Run Electron's installer: pnpm can skip it when it reuses its store, leaving no binary.
// 2. macOS shows the bundle's CFBundleName in the menu bar, so `pnpm dev` would say "Electron".
//    Rename the dev copy (packaged builds get their name from electron-builder).
import { execFileSync } from 'node:child_process';
import { realpathSync, renameSync } from 'node:fs';

execFileSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit' });

if (process.platform === 'darwin') {
  const plist = 'node_modules/electron/dist/Electron.app/Contents/Info.plist';
  const tmp = `${plist}.tmp`;
  // Write a new file and rename it over, never edit in place: the file could be a hard link into a shared cache.
  execFileSync('plutil', ['-replace', 'CFBundleName', '-string', 'Chalkline', '-o', tmp, plist]);
  execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'Chalkline', tmp]);
  renameSync(tmp, plist);
  // Editing Info.plist breaks the bundle's signature; re-sign ad hoc so macOS still launches it.
  const app = realpathSync('node_modules/electron/dist/Electron.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app]);
  // macOS caches app names; make it re-read this bundle now.
  execFileSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', app],
  );
}
