import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arch, build, Platform } from 'electron-builder';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const arch = process.argv[2] ?? 'arm64';
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch))
  throw new Error('Run on macOS, with optional architecture arm64 or x64.');
if (!process.env.CSC_NAME?.startsWith('Developer ID Application:'))
  throw new Error('Set CSC_NAME to your full Developer ID Application signing identity.');
const appleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
const apiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
if (!appleId && !apiKey)
  throw new Error('Set Apple notarization credentials (Apple ID/password/team, or API key/path/id/issuer).');
if (apiKey && !existsSync(process.env.APPLE_API_KEY)) throw new Error('APPLE_API_KEY file does not exist.');

const vite = join(root, 'node_modules/electron-vite/bin/electron-vite.js');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(process.execPath, [vite, 'build'], { cwd: root, env, stdio: 'inherit' });
await build({
  targets: Platform.MAC.createTarget(['zip', 'dmg'], Arch[arch]),
  publish: 'never',
  config: {
    extends: join(root, 'electron-builder.yml'),
    forceCodeSigning: true,
    mac: {
      identity: process.env.CSC_NAME,
      hardenedRuntime: true,
      entitlements: join(root, 'build/entitlements.mac.plist'),
      entitlementsInherit: join(root, 'build/entitlements.mac.plist'),
      notarize: true,
    },
  },
});
const app = join(root, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', `${pkg.productName}.app`);
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
execFileSync('spctl', ['--assess', '--type', 'execute', app], { stdio: 'inherit' });
console.log(`Verified signed/notarized ${pkg.productName} ${pkg.version} (${arch}). No release was published.`);
