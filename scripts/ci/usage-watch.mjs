// Daily free-tier check for the parts of the stack that can bill a card or stop working
// when a free limit runs out (docs/tech-stack.md sections 20 and 21).
//
//   CF_ANALYTICS_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/ci/usage-watch.mjs
//
// It reads Cloudflare usage (R2 storage and operations, Workers requests) from the GraphQL
// Analytics API and checks the dates in REMINDERS. It writes a table to the GitHub Actions job
// summary and exits with 1 when anything is at or past its warning level, so the scheduled run
// fails and GitHub emails the repository owner. It changes nothing.
//
// Azure is not checked here: the subscription has a spending limit (it cannot charge a card),
// and Azure Monitor alerts plus a $5 budget email the owner directly (infra/azure/README.md).

import { appendFileSync } from 'node:fs'

// Free allowances and the level that triggers a warning. R2 bills the card on file past its
// free tier and has no spending cap; Workers Free never bills, it refuses requests instead.
const LIMITS = {
  r2StorageBytes: { free: 10e9, warnAt: 8e9, label: 'R2 storage (all buckets)', unit: 'bytes' },
  r2ClassA: { free: 1_000_000, warnAt: 800_000, label: 'R2 Class A operations, this month' },
  r2ClassB: { free: 10_000_000, warnAt: 8_000_000, label: 'R2 Class B operations, this month' },
  workersDaily: { free: 100_000, warnAt: 80_000, label: 'Workers requests, yesterday (UTC)' },
}

// Dates that need action. Warns from `warnDaysBefore` days ahead until the date is moved.
// Leave `date` null when it is not known yet; the summary then lists it as not set.
const REMINDERS = [
  {
    what: 'Azure for Students credit and 12 months of free services end',
    date: null,
    todo: 'Renew Azure for Students, or move hosting (docs/tech-stack.md section 22)',
    warnDaysBefore: 45,
  },
  {
    what: 'Domain khandanirishta.app renews',
    date: null,
    todo: "Check the registrar's renewal price and auto-renew setting",
    warnDaysBefore: 30,
  },
  {
    what: 'Cloudflare Access service token github-actions-deploy expires (API deploys stop)',
    date: '2027-11-27',
    todo: 'Refresh it in Zero Trust > Access > Service credentials, then update CF_ACCESS_CLIENT_SECRET',
    warnDaysBefore: 30,
  },
]

// R2 operation classes, from https://developers.cloudflare.com/r2/pricing/. Anything else
// (DeleteObject, DeleteBucket, AbortMultipartUpload) is free.
const CLASS_A = new Set([
  'ListBuckets',
  'PutBucket',
  'ListObjects',
  'PutObject',
  'CopyObject',
  'CompleteMultipartUpload',
  'CreateMultipartUpload',
  'LifecycleStorageTierTransition',
  'ListMultipartUploads',
  'UploadPart',
  'UploadPartCopy',
  'ListParts',
  'PutBucketEncryption',
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
])
const CLASS_B = new Set([
  'HeadBucket',
  'HeadObject',
  'GetObject',
  'UsageSummary',
  'GetBucketEncryption',
  'GetBucketLocation',
  'GetBucketCors',
  'GetBucketLifecycleConfiguration',
])

const QUERY = `
query Usage($account: String!, $monthStart: Time!, $dayAgo: Time!, $now: Time!, $yesterday: Time!, $today: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      storage: r2StorageAdaptiveGroups(limit: 100, filter: { datetime_geq: $dayAgo, datetime_leq: $now }) {
        max { payloadSize metadataSize objectCount }
        dimensions { bucketName }
      }
      operations: r2OperationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $monthStart, datetime_leq: $now }) {
        sum { requests }
        dimensions { actionType }
      }
      workers: workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $yesterday, datetime_lt: $today }) {
        sum { requests }
      }
    }
  }
}`

const DAY_MS = 24 * 60 * 60 * 1000

async function main() {
  const token = process.env.CF_ANALYTICS_TOKEN
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !account) {
    throw new Error('CF_ANALYTICS_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set')
  }

  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const usage = await fetchUsage(token, {
    account,
    monthStart: monthStart.toISOString(),
    dayAgo: new Date(now.getTime() - DAY_MS).toISOString(),
    now: now.toISOString(),
    yesterday: new Date(today.getTime() - DAY_MS).toISOString(),
    today: today.toISOString(),
  })

  // Share of the month gone, for a straight-line projection of this month's operations.
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate()
  const elapsedDays = (now.getTime() - monthStart.getTime()) / DAY_MS

  const rows = []
  let warnings = 0

  for (const [key, limit] of Object.entries(LIMITS)) {
    const value = usage[key]
    const projectable = key === 'r2ClassA' || key === 'r2ClassB'
    // Skip projections in the first 3 days, when one busy day skews the estimate.
    const projected = projectable && elapsedDays >= 3 ? (value / elapsedDays) * daysInMonth : null
    const over = value >= limit.warnAt || (projected !== null && projected >= limit.free)
    if (over) warnings++
    rows.push([
      over ? 'Warning' : 'OK',
      limit.label,
      format(value, limit.unit),
      `${format(limit.free, limit.unit)} free, warns at ${format(limit.warnAt, limit.unit)}`,
      projected === null ? '' : `on pace for ${format(Math.round(projected), limit.unit)}`,
    ])
  }

  for (const reminder of REMINDERS) {
    if (!reminder.date) {
      rows.push(['Not set', reminder.what, '', 'Add the date in scripts/ci/usage-watch.mjs', ''])
      continue
    }
    const daysLeft = Math.ceil(
      (Date.parse(`${reminder.date}T00:00:00Z`) - today.getTime()) / DAY_MS,
    )
    const due = daysLeft <= reminder.warnDaysBefore
    if (due) warnings++
    rows.push([
      due ? 'Warning' : 'OK',
      reminder.what,
      reminder.date,
      daysLeft < 0 ? `${-daysLeft} days ago` : `in ${daysLeft} days`,
      due ? reminder.todo : '',
    ])
  }

  const table = [
    '| Status | What | Now | Limit | Note |',
    '|---|---|---|---|---|',
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n')
  const summary = `## Free-tier usage\n\n${table}\n\nStorage by bucket: ${usage.buckets}\n`
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)

  if (warnings > 0) {
    console.log(`::error::${warnings} item(s) need attention. See the table above.`)
    process.exit(1)
  }
}

async function fetchUsage(token, variables) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.errors?.length) {
    const reason = body.errors?.map((error) => error.message).join('; ') || response.statusText
    throw new Error(`Cloudflare GraphQL request failed (${response.status}): ${reason}`)
  }
  const [result] = body.data.viewer.accounts
  if (!result) throw new Error('The token cannot read analytics for this account')

  const bucketSizes = result.storage.map(({ max, dimensions }) => ({
    name: dimensions.bucketName,
    bytes: max.payloadSize + max.metadataSize,
  }))
  let classA = 0
  let classB = 0
  for (const { sum, dimensions } of result.operations) {
    if (CLASS_A.has(dimensions.actionType)) classA += sum.requests
    else if (CLASS_B.has(dimensions.actionType)) classB += sum.requests
  }
  return {
    r2StorageBytes: bucketSizes.reduce((total, bucket) => total + bucket.bytes, 0),
    r2ClassA: classA,
    r2ClassB: classB,
    workersDaily: result.workers.reduce((total, group) => total + group.sum.requests, 0),
    buckets:
      bucketSizes.map((bucket) => `${bucket.name} ${format(bucket.bytes, 'bytes')}`).join(', ') ||
      'no data yet',
  }
}

function format(value, unit) {
  if (unit === 'bytes') return `${(value / 1e9).toFixed(2)} GB`
  return value.toLocaleString('en-US')
}

main().catch((error) => {
  console.log(`::error::${error.message}`)
  process.exit(1)
})
