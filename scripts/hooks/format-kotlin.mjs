// Formats the Android app's Kotlin and Gradle Kotlin DSL files with ktlint, through Spotless.
// Used by the pre-commit hook (lint-staged) when Kotlin files are staged.
//
// Without a JDK it only warns: CI checks formatting too.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const androidDir = fileURLToPath(new URL('../../apps/android/', import.meta.url))
const gradlew = fileURLToPath(new URL(isWindows ? 'gradlew.bat' : 'gradlew', `file:${androidDir}`))

const probe = spawnSync('java', ['-version'], { stdio: 'ignore' })
if ((probe.error || probe.status !== 0) && !process.env.JAVA_HOME) {
  console.warn('No JDK found: skipping Kotlin formatting. CI still checks it.')
  process.exit(0)
}

// The wrapper is a batch file on Windows, which Node can only start through a shell. The path
// is absolute and quoted, so it works from any directory and with spaces in it.
const result = spawnSync(isWindows ? `"${gradlew}"` : gradlew, ['spotlessApply', '--quiet'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
})
process.exit(result.status ?? 1)
