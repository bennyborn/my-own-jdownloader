// Builds the browser packages of a release from `extension/` with the same manifest changes the backend makes (backend/src/extension.ts;
// run `npm run build -w backend` first). Usage: node scripts/release-extension.mjs <out dir> <update url of the Firefox build>
// Writes <out>/chrome/ and <out>/firefox/ (folders to zip / to sign); the id is the one of the source manifest.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTENSION_TARGETS } from '../backend/dist/extension.js'

const [out, updateUrl] = process.argv.slice(2)
if (!out || !updateUrl) throw new Error('usage: release-extension.mjs <out dir> <firefox update url>')

const source = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))
rmSync(out, { recursive: true, force: true })
for (const target of ['chrome', 'firefox']) {
  const dir = join(out, target)
  mkdirSync(dir, { recursive: true })
  cpSync('extension', dir, { recursive: true, filter: (path) => !/(^|\/)(\.[^/]+|README\.md)$/.test(path) })
  const manifest = EXTENSION_TARGETS[target === 'chrome' ? 'chromium' : 'firefox'].manifest(source, {
    publicUrl: '',
    firefoxId: source.browser_specific_settings.gecko.id,
    updateUrl
  })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}
console.log(`version ${source.version}, Firefox id ${source.browser_specific_settings.gecko.id}`)
