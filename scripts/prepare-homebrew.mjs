import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--repo', '--archive', '--arch', '--output'].includes(key) || !process.argv[i + 1])
    throw new Error('Usage: --repo OWNER/REPO --archive ZIP [--arch arm64|x64] [--output CASK.rb]');
  options.set(key, process.argv[i + 1]);
}
const repo = options.get('--repo');
const arch = options.get('--arch') ?? 'arm64';
if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo ?? '') || !['arm64', 'x64'].includes(arch))
  throw new Error('Provide a real GitHub OWNER/REPO and an architecture arm64 or x64.');
if (!options.has('--archive')) throw new Error('Provide the versioned release ZIP via --archive.');
const archive = resolve(options.get('--archive'));
const expected = `${pkg.name}-${pkg.version}-${arch}.zip`;
if (basename(archive) !== expected) throw new Error(`Expected artifact filename ${expected}.`);
const app = `${pkg.productName}.app/Contents`;
const plist = execFileSync('unzip', ['-p', archive, `${app}/Info.plist`]);
const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: plist, encoding: 'utf8' }));
if (info.CFBundleDisplayName !== pkg.productName || info.CFBundleExecutable !== pkg.productName ||
    info.CFBundleShortVersionString !== pkg.version || info.CFBundleIdentifier !== 'dev.open-eraser.app')
  throw new Error('The archive name, version or bundle identity does not match this app.');
const icon = execFileSync('unzip', ['-p', archive, `${app}/Resources/${info.CFBundleIconFile}`]);
if (icon.toString('ascii', 0, 4) !== 'icns') throw new Error('The archive is missing its macOS icon.');
const binary = execFileSync('unzip', ['-p', archive, `${app}/MacOS/${info.CFBundleExecutable}`]);
if (binary.readUInt32LE(0) !== 0xfeedfacf || binary.readUInt32LE(4) !== (arch === 'arm64' ? 0x100000c : 0x1000007))
  throw new Error('The executable does not match the declared architecture.');
const hash = createHash('sha256');
for await (const chunk of createReadStream(archive)) hash.update(chunk);
const sha = hash.digest('hex');
const output = resolve(options.get('--output') ?? join(root, 'packaging/homebrew/Casks', `${pkg.name}.rb`));
const cask = `cask "${pkg.name}" do
  version "${pkg.version}"
  sha256 "${sha}"

  url "https://github.com/${repo}/releases/download/v#{version}/${pkg.name}-#{version}-${arch}.zip"
  name "${pkg.productName}"
  desc "Local-first AI architecture diagram editor"
  homepage "https://github.com/${repo}"

  depends_on arch: :${arch === 'arm64' ? 'arm64' : 'intel'}
  depends_on macos: ">= :ventura"

  app "${pkg.productName}.app"
end
`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, cask);
console.log(`${output}\nSHA-256 ${sha}\nUpload ${expected} unchanged to ${repo} release v${pkg.version}. No release was published.`);
