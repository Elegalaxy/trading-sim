import { existsSync, readdirSync, readFileSync, writeSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Section 2.2 import rules. Adapted from a copy of the RPG architecture test.
// This file does not import rpg/.
//
// src/sim is an allowlist: only other sim files. Unit tests live next to
// source, so *.test.ts / *.spec.ts under src/sim may import vitest only.
// Those test files may call console for debug output. Production src/sim may not.
// src/main.tsx is the app entry, not one of the five layers.

function debugArchitecture(message: string): void {
  // fd 1, not console.log: Vitest's reporter hides console output when the test passes.
  writeSync(1, `[DEBUG architecture] ${message}\n`)
}

const TRADING_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(TRADING_ROOT, 'src')
const RPG_DIR = resolve(TRADING_ROOT, '..', 'rpg')

const LAYERS = ['sim', 'content', 'harness', 'persist', 'ui'] as const
type Layer = (typeof LAYERS)[number]
type FileLayer = Layer | 'entry'

type ImportHit = { spec: string; line: number }
type Resolved =
  | { kind: 'relative'; layer: Layer | null }
  | { kind: 'package' }

const OUTSIDE_LAYER_RULE =
  'file is not in a layer (sim, content, harness, persist, ui) or the app entry'
const RPG_IMPORT_RULE = 'trading-sim must not import from rpg/'

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

const SIM_API_RULES: { source: string; rule: string }[] = [
  { source: String.raw`Math\s*\.\s*random\b`, rule: 'src/sim must not use Math.random' },
  { source: String.raw`\bDate\b`, rule: 'src/sim must not use Date' },
  { source: String.raw`performance\s*\.\s*now\b`, rule: 'src/sim must not use performance.now' },
  { source: String.raw`\bconsole\b`, rule: 'src/sim must not use console' },
  { source: String.raw`\blocalStorage\b`, rule: 'src/sim must not use localStorage' },
  {
    source: String.raw`\b(?:sessionStorage|indexedDB)\b`,
    rule: 'src/sim must not use browser storage',
  },
  { source: String.raw`\bprocess\b`, rule: 'src/sim must not use process' },
  {
    source: String.raw`\b(?:document|window|navigator|XMLHttpRequest|HTMLElement|customElements|requestAnimationFrame)\b|\bfetch\s*\(`,
    rule: 'src/sim must not use DOM globals',
  },
]

const CONTENT_IO_RULES: { source: string; rule: string }[] = [
  { source: String.raw`\blocalStorage\b`, rule: 'src/content must not perform I/O' },
  { source: String.raw`\bsessionStorage\b`, rule: 'src/content must not perform I/O' },
  { source: String.raw`\bindexedDB\b`, rule: 'src/content must not perform I/O' },
  { source: String.raw`\bXMLHttpRequest\b`, rule: 'src/content must not perform I/O' },
  { source: String.raw`\bfetch\s*\(`, rule: 'src/content must not perform I/O' },
]

const SPECIFIER_PATTERNS = [
  /\bfrom\s+(['"])([^'"]+)\1/g,
  /\bimport\s+(['"])([^'"]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"]+)\1/g,
  /\brequire\s*\(\s*(['"])([^'"]+)\1/g,
]

function isLayer(value: string): value is Layer {
  return (LAYERS as readonly string[]).includes(value)
}

function displayPath(absFile: string): string {
  return relative(TRADING_ROOT, absFile).replaceAll('\\', '/')
}

function isTestFile(absFile: string): boolean {
  return /\.(?:test|spec)\.tsx?$/.test(absFile)
}

function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

function maskComments(source: string): string {
  const chars = source.split('')
  const length = chars.length
  let i = 0
  while (i < length) {
    const current = chars[i]
    const next = chars[i + 1]
    if (current === '/' && next === '/') {
      while (i < length && chars[i] !== '\n') {
        chars[i] = ' '
        i += 1
      }
      continue
    }
    if (current === '/' && next === '*') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i += 2
      while (i < length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' '
        i += 1
      }
      if (i < length) {
        chars[i] = ' '
        if (i + 1 < length) chars[i + 1] = ' '
        i += 2
      }
      continue
    }
    if (current === "'" || current === '"' || current === '`') {
      const quote = current
      i += 1
      while (i < length) {
        if (chars[i] === '\\') {
          i += 2
          continue
        }
        if (chars[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    i += 1
  }
  return chars.join('')
}

function importSpecifiers(source: string): ImportHit[] {
  const hits: ImportHit[] = []
  const seen = new Set<number>()
  for (const pattern of SPECIFIER_PATTERNS) {
    const re = new RegExp(pattern.source, 'g')
    for (const match of source.matchAll(re)) {
      const index = match.index ?? 0
      const spec = match[2]
      if (spec === undefined || seen.has(index)) continue
      seen.add(index)
      hits.push({ spec, line: lineAt(source, index) })
    }
  }
  hits.sort((a, b) => a.line - b.line || a.spec.localeCompare(b.spec))
  return hits
}

function layerOfRelative(relFromSrc: string): Layer | null {
  const top = relFromSrc.replaceAll('\\', '/').split('/')[0] ?? ''
  return isLayer(top) ? top : null
}

function layerOfFile(absFile: string): FileLayer | null {
  const rel = relative(SRC_DIR, absFile).replaceAll('\\', '/')
  if (rel === 'main.tsx') return 'entry'
  return layerOfRelative(rel)
}

function isInsideDir(dir: string, absFile: string): boolean {
  const rel = relative(dir, absFile)
  if (rel === '') return true
  if (rel.startsWith('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false
  return true
}

function isRpgImport(fromFile: string, spec: string): boolean {
  const normalized = spec.replaceAll('\\', '/')
  if (!normalized.startsWith('.')) {
    return normalized.split('/').some((part) => part === 'rpg')
  }
  return isInsideDir(RPG_DIR, resolve(dirname(fromFile), normalized))
}

function resolveSpecifier(fromFile: string, spec: string): Resolved {
  if (!spec.startsWith('.')) return { kind: 'package' }
  const abs = resolve(dirname(fromFile), spec)
  const rel = relative(SRC_DIR, abs)
  if (rel.startsWith('..') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    return { kind: 'relative', layer: null }
  }
  return { kind: 'relative', layer: layerOfRelative(rel) }
}

function isReactSpecifier(spec: string): boolean {
  return (
    spec === 'react' ||
    spec.startsWith('react/') ||
    spec === 'react-dom' ||
    spec.startsWith('react-dom/')
  )
}

function isNodeSpecifier(spec: string): boolean {
  if (spec.startsWith('node:')) return true
  const name = spec.split('/')[0] ?? spec
  return NODE_BUILTINS.has(name)
}

function isIoSpecifier(spec: string): boolean {
  const bare = spec.startsWith('node:') ? spec.slice('node:'.length) : spec
  return /^(?:fs|https?|http2|net|dgram|child_process|readline|tls|dns)(?:\/|$)/.test(bare)
}

function isVitestSpecifier(spec: string): boolean {
  return spec === 'vitest' || spec.startsWith('vitest/')
}

function forbidden(spec: string, rule: string): string {
  return `${rule} (forbidden import '${spec}')`
}

function importRule(layer: Layer, absFile: string, spec: string): string | null {
  if (isRpgImport(absFile, spec)) return forbidden(spec, RPG_IMPORT_RULE)

  const resolved = resolveSpecifier(absFile, spec)
  const resolvedLayer = resolved.kind === 'relative' ? resolved.layer : null

  if (layer === 'sim') {
    if (resolvedLayer === 'sim') return null
    if (isTestFile(absFile) && isVitestSpecifier(spec)) return null
    if (isReactSpecifier(spec)) return forbidden(spec, 'src/sim must not import React')
    if (isNodeSpecifier(spec)) return forbidden(spec, 'src/sim must not import node:* or process')
    if (spec === 'localStorage') return forbidden(spec, 'src/sim must not import localStorage')
    if (resolvedLayer !== null) return forbidden(spec, `src/sim must not import src/${resolvedLayer}`)
    return forbidden(spec, 'src/sim may import only other src/sim files')
  }

  if (layer === 'content') {
    if (resolvedLayer === 'ui' || isReactSpecifier(spec)) {
      return forbidden(spec, 'src/content must not import UI')
    }
    if (resolvedLayer === 'persist') return forbidden(spec, 'src/content must not import persistence')
    if (resolvedLayer === 'harness') return forbidden(spec, 'src/content must not import harness')
    if (isIoSpecifier(spec)) return forbidden(spec, 'src/content must not perform I/O')
    return null
  }

  if (layer === 'harness') {
    if (resolvedLayer === 'ui') return forbidden(spec, 'src/harness must not import src/ui')
    if (resolvedLayer === 'persist') return forbidden(spec, 'src/harness must not import src/persist')
    return null
  }

  if (layer === 'persist') {
    if (resolvedLayer === 'ui') return forbidden(spec, 'src/persist must not import src/ui')
    if (resolvedLayer === 'harness') return forbidden(spec, 'src/persist must not import src/harness')
    if (resolvedLayer === 'content') return forbidden(spec, 'src/persist may import only sim types')
    return null
  }

  if (resolvedLayer === 'harness') return forbidden(spec, 'src/ui must not import src/harness')
  return null
}

function apiHits(source: string, rules: { source: string; rule: string }[]): { line: number; rule: string }[] {
  const hits: { line: number; rule: string }[] = []
  for (const apiRule of rules) {
    const re = new RegExp(apiRule.source, 'g')
    for (const match of source.matchAll(re)) {
      hits.push({ line: lineAt(source, match.index ?? 0), rule: apiRule.rule })
    }
  }
  return hits
}

function walkTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(full))
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name.endsWith('.d.ts')) continue
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(full)
  }
  return files
}

function checkFile(absFile: string, text: string): { layer: FileLayer | null; specs: string[]; violations: string[] } {
  const display = displayPath(absFile)
  const layer = layerOfFile(absFile)
  const masked = maskComments(text)
  const imports = importSpecifiers(masked)
  const violations: string[] = []

  if (layer === null || layer === 'entry') {
    for (const hit of imports) {
      if (isRpgImport(absFile, hit.spec)) {
        violations.push(`${display}:${hit.line}: ${forbidden(hit.spec, RPG_IMPORT_RULE)}`)
      }
    }
    if (layer === null) violations.push(`${display}:1: ${OUTSIDE_LAYER_RULE}`)
  } else {
    for (const hit of imports) {
      const rule = importRule(layer, absFile, hit.spec)
      if (rule !== null) violations.push(`${display}:${hit.line}: ${rule}`)
    }
    let apiRules: { source: string; rule: string }[] = []
    if (layer === 'sim') {
      apiRules = SIM_API_RULES
      if (isTestFile(absFile)) {
        apiRules = SIM_API_RULES.filter((apiRule) => apiRule.rule !== 'src/sim must not use console')
      }
    } else if (layer === 'content') {
      apiRules = CONTENT_IO_RULES
    }
    for (const hit of apiHits(masked, apiRules)) {
      violations.push(`${display}:${hit.line}: ${hit.rule}`)
    }
  }

  return { layer, specs: imports.map((hit) => hit.spec), violations }
}

function fixturePath(relFromSrc: string): string {
  return join(SRC_DIR, ...relFromSrc.split('/'))
}

function expectRule(relFromSrc: string, source: string, rule: string): void {
  const violations = checkFile(fixturePath(relFromSrc), source).violations
  const display = `src/${relFromSrc}`
  debugArchitecture(
    `fixture file=${display} rule=${JSON.stringify(rule)} violations=${JSON.stringify(violations)}`,
  )
  const matched = violations.find((violation) => violation.includes(rule))
  expect(matched, `${display} missing rule ${rule}; got ${JSON.stringify(violations)}`).toBeTruthy()
  expect(matched ?? '').toMatch(new RegExp(`^${display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+:`))
}

function expectAllowed(relFromSrc: string, source: string): void {
  const violations = checkFile(fixturePath(relFromSrc), source).violations
  debugArchitecture(`fixture file=src/${relFromSrc} allowed violations=${JSON.stringify(violations)}`)
  expect(violations).toEqual([])
}

describe('architecture boundaries', () => {
  it('checks each existing src file against the section 2.2 import rules', () => {
    if (!existsSync(SRC_DIR)) {
      throw new Error(`[DEBUG architecture] src directory not found: ${SRC_DIR}`)
    }

    const files = walkTsFiles(SRC_DIR).sort()
    debugArchitecture(`input src=${SRC_DIR} files=${files.length}`)

    const counts: Record<FileLayer | 'none', number> = {
      sim: 0,
      content: 0,
      harness: 0,
      persist: 0,
      ui: 0,
      entry: 0,
      none: 0,
    }
    const violations: string[] = []
    let appLayer: FileLayer | 'none' | undefined

    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const result = checkFile(file, text)
      const layer = result.layer ?? 'none'
      counts[layer] += 1
      const display = displayPath(file)
      if (display === 'src/ui/App.tsx') appLayer = layer
      debugArchitecture(
        `file=${display} layer=${layer} imports=${JSON.stringify(result.specs)} violations=${result.violations.length}`,
      )
      for (const violation of result.violations) {
        debugArchitecture(`violation ${violation}`)
      }
      violations.push(...result.violations)
    }

    debugArchitecture(`layer counts ${JSON.stringify(counts)}`)
    debugArchitecture(`output violations=${violations.length}`)
    expect(files.length).toBeGreaterThan(0)
    expect(appLayer).toBe('ui')
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('bans forbidden sim APIs and cross-layer imports', () => {
    const banned = [
      { source: 'Math.random()', rule: 'src/sim must not use Math.random' },
      { source: 'Date.now()', rule: 'src/sim must not use Date' },
      { source: 'performance.now()', rule: 'src/sim must not use performance.now' },
      { source: 'console.log(1)', rule: 'src/sim must not use console' },
      { source: 'localStorage.getItem("k")', rule: 'src/sim must not use localStorage' },
      { source: 'sessionStorage.getItem("k")', rule: 'src/sim must not use browser storage' },
      { source: 'indexedDB', rule: 'src/sim must not use browser storage' },
      { source: 'process.env', rule: 'src/sim must not use process' },
      { source: 'document.body', rule: 'src/sim must not use DOM globals' },
      { source: 'window', rule: 'src/sim must not use DOM globals' },
      { source: 'fetch("/x")', rule: 'src/sim must not use DOM globals' },
    ] as const

    for (const entry of banned) {
      expectRule('sim/fixture.ts', entry.source, entry.rule)
    }

    expectAllowed('sim/fixture.test.ts', 'console.log(1)')
    expectAllowed('sim/fixture.ts', '// Math.random()\nexport const n = 1\n')
    expectRule('sim/fixture.test.ts', 'Math.random()', 'src/sim must not use Math.random')
    expectRule('sim/fixture.test.ts', "import React from 'react'", 'src/sim must not import React')
    expectAllowed('sim/fixture.test.ts', "import { it } from 'vitest'\nconsole.log('[DEBUG rng]')")
    expectAllowed('sim/market.ts', "import { step } from './rng.ts'")
    expectRule('sim/market.ts', "import fs from 'node:fs'", 'src/sim must not import node:* or process')
    expectRule('sim/market.ts', "import x from '../ui/App.tsx'", 'src/sim must not import src/ui')
    expectRule('sim/market.ts', "import x from '../../../rpg/src/foo.ts'", RPG_IMPORT_RULE)

    expectAllowed('content/assets.ts', "import type { Asset } from '../sim/types.ts'")
    expectAllowed('content/index.ts', "import { assets } from './assets.ts'")
    expectRule('content/assets.ts', "import x from '../ui/App.tsx'", 'src/content must not import UI')
    expectRule('content/assets.ts', "import x from '../harness/cli.ts'", 'src/content must not import harness')
    expectRule('content/assets.ts', "import x from '../persist/save.ts'", 'src/content must not import persistence')
    expectRule('content/assets.ts', "import fs from 'node:fs'", 'src/content must not perform I/O')
    expectRule('content/assets.ts', 'fetch("/x")', 'src/content must not perform I/O')

    expectAllowed(
      'harness/cli.ts',
      "import { readFileSync } from 'node:fs'\nimport { step } from '../sim/market.ts'\nimport { assets } from '../content/assets.ts'",
    )
    expectAllowed('harness/cli.ts', "import { run } from './batch.ts'")
    expectRule('harness/cli.ts', "import x from '../ui/App.tsx'", 'src/harness must not import src/ui')
    expectRule('harness/cli.ts', "import x from '../persist/save.ts'", 'src/harness must not import src/persist')

    expectAllowed('persist/save.ts', "import type { State } from '../sim/types.ts'")
    expectAllowed('persist/save.ts', "import { loadScores } from './scores.ts'")
    expectRule('persist/save.ts', "import x from '../ui/App.tsx'", 'src/persist must not import src/ui')
    expectRule('persist/save.ts', "import x from '../harness/cli.ts'", 'src/persist must not import src/harness')
    expectRule('persist/save.ts', "import x from '../content/assets.ts'", 'src/persist may import only sim types')

    expectAllowed(
      'ui/App.tsx',
      "import { step } from '../sim/market.ts'\nimport { assets } from '../content/assets.ts'\nimport { load } from '../persist/save.ts'\nimport { debugLog } from './debug.ts'\nimport React from 'react'",
    )
    expectRule('ui/App.tsx', "import x from '../harness/cli.ts'", 'src/ui must not import src/harness')

    expectAllowed(
      'main.tsx',
      "import { StrictMode } from 'react'\nimport App from './ui/App.tsx'\ndocument.getElementById('root')\n",
    )
    expectRule('main.tsx', "import x from '../../rpg/src/foo.ts'\n", RPG_IMPORT_RULE)
    expectRule('other.ts', 'export const n = 1\n', OUTSIDE_LAYER_RULE)
  })
})
