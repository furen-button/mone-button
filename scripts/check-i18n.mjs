import { readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const localeDir = path.join(projectRoot, 'public', 'i18n')
const locales = ['ja', 'en']

async function loadJson(locale) {
  const filePath = path.join(localeDir, `${locale}.json`)
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

function collectPaths(tree, prefix = '') {
  const paths = []

  for (const [key, value] of Object.entries(tree)) {
    const nextPath = prefix ? `${prefix}.${key}` : key

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectPaths(value, nextPath))
      continue
    }

    paths.push(nextPath)
  }

  return paths
}

function getNode(tree, keyPath) {
  return keyPath.split('.').reduce((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined
    }

    return current[segment]
  }, tree)
}

function describeType(value) {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
}

const dictionaries = await Promise.all(locales.map(async (locale) => [locale, await loadJson(locale)]))
const entries = Object.fromEntries(dictionaries)

const baseLocale = 'ja'
const basePaths = new Set(collectPaths(entries[baseLocale]))
const errors = []

for (const locale of locales) {
  if (locale === baseLocale) {
    continue
  }

  const targetPaths = new Set(collectPaths(entries[locale]))

  for (const keyPath of basePaths) {
    if (!targetPaths.has(keyPath)) {
      errors.push(`[${locale}] missing key: ${keyPath}`)
    }
  }

  for (const keyPath of targetPaths) {
    if (!basePaths.has(keyPath)) {
      errors.push(`[${locale}] extra key: ${keyPath}`)
    }
  }

  for (const keyPath of basePaths) {
    const baseValue = getNode(entries[baseLocale], keyPath)
    const targetValue = getNode(entries[locale], keyPath)

    if (baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)) {
      continue
    }

    if ((baseValue && typeof baseValue === 'object') !== (targetValue && typeof targetValue === 'object')) {
      errors.push(`[${locale}] type mismatch: ${keyPath}`)
      continue
    }

    if (describeType(baseValue) !== describeType(targetValue)) {
      errors.push(`[${locale}] type mismatch: ${keyPath}`)
    }
  }
}

if (errors.length > 0) {
  console.error('i18n key parity check failed:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('i18n key parity check passed.')