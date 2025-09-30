// frontend/scripts/audit-settings-usage.mjs
// Safe read-only audit. Prints where and how "settings" is used.
// Run: node frontend/scripts/audit-settings-usage.mjs

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// If your source lives at frontend/src, leave this as-is.
const ROOT = path.resolve(__dirname, '..', 'src')

function walk(dir, out = []) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(ROOT)

const hits = {
  imports: [],
  useSettingsCalls: [],
  destructMembers: [],
  destructSettings: [],
  membersDotMap: [],
  storageReads: [],
}

function record(list, file, line, text) {
  const rel = file.replace(process.cwd() + path.sep, '')
  list.push({ file: rel, line, text: text.trim() })
}

for (const f of files) {
  let content = ''
  try { content = fs.readFileSync(f, 'utf8') } catch { continue }
  const lines = content.split('\n')

  lines.forEach((line, i) => {
    // Imports of state/settings with any path variation
    if (/\bfrom\s+['"].*state\/settings(\.tsx?|\/index)?['"]/.test(line)) {
      record(hits.imports, f, i + 1, line)
    }
    // useSettings() calls
    if (/\buseSettings\s*\(/.test(line)) {
      record(hits.useSettingsCalls, f, i + 1, line)
    }
    // const { members } = useSettings()
    if (/const\s*\{\s*members\s*\}\s*=\s*useSettings\s*\(/.test(line)) {
      record(hits.destructMembers, f, i + 1, line)
    }
    // const { settings } = useSettings()
    if (/const\s*\{\s*settings\s*\}\s*=\s*useSettings\s*\(/.test(line)) {
      record(hits.destructSettings, f, i + 1, line)
    }
    // t.members.map(...)
    if (/\.\s*members\s*\.map\s*\(/.test(line)) {
      record(hits.membersDotMap, f, i + 1, line)
    }
    // Module-scope reads of localStorage fc_settings_v3
    if (/localStorage\.getItem\s*\(\s*['"]fc_settings_v3['"]\s*\)/.test(line)) {
      record(hits.storageReads, f, i + 1, line)
    }
  })
}

function print(title, arr) {
  console.log('\n### ' + title + ' (' + arr.length + ')')
  arr.forEach((x) => console.log(`${x.file}:${x.line}: ${x.text}`))
}

console.log(`Scanning ${files.length} source files under ${ROOT} …`)
print('Imports of state/settings*', hits.imports)
print('useSettings(...) call sites', hits.useSettingsCalls)
print('Destructure { members } from useSettings', hits.destructMembers)
print('Destructure { settings } from useSettings', hits.destructSettings)
print('Direct `.members.map(...)` usages', hits.membersDotMap)
print('Module-scope reads of fc_settings_v3', hits.storageReads)
console.log('\nDone.\n')
