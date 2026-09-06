import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const topics = ['API', 'ARCHITECTURE', 'CLI', 'DATA-FORMAT', 'MCP', 'SDK', 'SECURITY']
const englishDocs = ['README.md', ...topics.map((name) => `docs/${name}.md`)]
const chineseDocs = ['README.zh-CN.md', ...topics.map((name) => `docs/${name}.zh-CN.md`)]

test('documentation has English primary pages and complete Simplified Chinese copies', async () => {
  for (const file of englishDocs) {
    const content = await readFile(resolve(root, file), 'utf8')
    assert.doesNotMatch(content, /[\p{Script=Han}]/u, `${file} must remain English-first`)
    assert.match(content, /Simplified Chinese/, `${file} must link to its Chinese copy`)
  }

  for (const file of chineseDocs) {
    const content = await readFile(resolve(root, file), 'utf8')
    assert.match(content, /[\p{Script=Han}]/u, `${file} must contain the full Chinese documentation`)
    assert.match(content, /\[English\]/, `${file} must link to its English primary page`)
  }

  const actualDocs = (await readdir(resolve(root, 'docs'))).filter((name) => name.endsWith('.md')).sort()
  const expectedDocs = [...topics.map((name) => `${name}.md`), ...topics.map((name) => `${name}.zh-CN.md`)].sort()
  assert.deepEqual(actualDocs, expectedDocs)
})

test('all local documentation links resolve', async () => {
  const files = [...englishDocs, ...chineseDocs]
  for (const file of files) {
    const absoluteFile = resolve(root, file)
    const content = await readFile(absoluteFile, 'utf8')
    const links = content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)
    for (const match of links) {
      const target = match[1].trim().split('#', 1)[0]
      if (!target || /^(?:https?:|mailto:)/i.test(target)) continue
      await assert.doesNotReject(
        access(resolve(dirname(absoluteFile), decodeURIComponent(target))),
        `${file} contains a broken link: ${match[1]}`,
      )
    }
  }
})

test('public documentation contains no machine-specific filesystem paths', async () => {
  const publicDocs = [...englishDocs, ...chineseDocs]
  const files = [
    ...publicDocs,
    'skills/relink/SKILL.md',
    'examples/sample.json',
    '.env.example',
    'package.json',
    'package-lock.json',
  ]
  const absoluteWindowsPath = /(?:^|[\s"'`(])[A-Za-z]:[\\/]/m
  const uncPath = /(?:^|[\s"'`(])\\\\[^\s"'`)]+/m
  const unixHomePath = /(?:^|[\s"'`(])\/(?:Users|home|tmp|private\/var|var\/tmp)(?:\/|$)/m
  const fileUri = /(?:^|[\s"'`(])file:\/\//im
  for (const file of files) {
    const content = await readFile(resolve(root, file), 'utf8')
    assert.doesNotMatch(content, absoluteWindowsPath, `${file} must not expose a Windows absolute path`)
    assert.doesNotMatch(content, uncPath, `${file} must not expose a UNC path`)
    assert.doesNotMatch(content, unixHomePath, `${file} must not expose a Unix home or temporary path`)
    assert.doesNotMatch(content, fileUri, `${file} must not expose a local file URI`)
  }

  const internalBuildPath = /(?:^|[\s"'`(])(?:node\s+)?dist[\\/]cli[\\/]index\.js(?:[\s"'`)\n]|$)/im
  for (const file of publicDocs) {
    const content = await readFile(resolve(root, file), 'utf8')
    assert.doesNotMatch(content, internalBuildPath, `${file} must use the public CLI entry point`)
  }
})
