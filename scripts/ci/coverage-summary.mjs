// Prints a Markdown coverage table from a `coverage-summary.json` (Vitest's json-summary
// reporter), for the GitHub Actions job summary.
//
//   node scripts/ci/coverage-summary.mjs <coverage-summary.json> [title] >> "$GITHUB_STEP_SUMMARY"

import { existsSync, readFileSync } from 'node:fs'

const [file, title = 'Coverage'] = process.argv.slice(2)

if (!file || !existsSync(file)) {
  console.log(`_No coverage report found at \`${file}\`._`)
  process.exit(0)
}

const { total } = JSON.parse(readFileSync(file, 'utf8'))
const metrics = ['lines', 'statements', 'functions', 'branches']

const rows = metrics.map((metric) => {
  const { covered, total: count, pct } = total[metric]
  const name = metric[0].toUpperCase() + metric.slice(1)
  return `| ${name} | ${pct}% | ${covered} of ${count} |`
})

console.log(
  [`### ${title}`, '', '| | Coverage | Covered |', '| --- | ---: | ---: |', ...rows, ''].join('\n'),
)
