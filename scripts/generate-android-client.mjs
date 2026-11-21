#!/usr/bin/env node
// Generates the Android API client from packages/api-contract/openapi.json: one Kotlin file per
// schema (kotlinx.serialization data classes and enums) and one Retrofit interface per tag.
//
//   node scripts/generate-android-client.mjs          writes the files
//   node scripts/generate-android-client.mjs --check  fails when the committed files differ
//
// Only the member API is generated: admin routes, webhooks, health checks and the WebSocket
// upgrade are left out (specs/22 section 5.1). Never edit the generated files by hand.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = join(root, 'packages/api-contract/openapi.json')
const basePackage = 'com.khandanirishta.app.core.network.generated'
const outDir = join(root, 'apps/android/app/src/main/java', ...basePackage.split('.'))
const check = process.argv.includes('--check')

const spec = JSON.parse(readFileSync(contractPath, 'utf8'))
const schemas = spec.components.schemas

const EXCLUDED_TAGS = new Set(['admin', 'webhooks', 'health'])
const EXCLUDED_PATHS = new Set(['/v1/ws'])
const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const KOTLIN_KEYWORDS = new Set([
  'as',
  'break',
  'class',
  'continue',
  'do',
  'else',
  'false',
  'for',
  'fun',
  'if',
  'in',
  'interface',
  'is',
  'null',
  'object',
  'package',
  'return',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'typeof',
  'val',
  'var',
  'when',
  'while',
])

// ---------------------------------------------------------------- naming

const camel = (snake) =>
  snake
    .replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
const pascal = (snake) => {
  const c = camel(snake)
  return c.charAt(0).toUpperCase() + c.slice(1)
}
const safeName = (name) => (KOTLIN_KEYWORDS.has(name) ? `${name}Value` : name)
const enumEntry = (wire) => {
  const name = wire
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
  return /^[0-9]/.test(name) ? `V_${name}` : name || 'EMPTY'
}
const refName = (ref) => ref.split('/').pop()

/** Kotlin class name for a contract schema name. `Page_X` pages are named `XPage`. */
function className(schemaName) {
  const page = /^Page_(.+)$/.exec(schemaName)
  if (page) return `${pascal(page[1])}Page`
  return pascal(schemaName)
}

// ---------------------------------------------------------------- operation selection

const operations = []
for (const [path, item] of Object.entries(spec.paths)) {
  if (EXCLUDED_PATHS.has(path)) continue
  for (const method of METHODS) {
    const op = item[method]
    if (!op) continue
    const tags = op.tags ?? ['default']
    if (tags.some((t) => EXCLUDED_TAGS.has(t))) continue
    operations.push({ path, method, op, tag: tags[0] })
  }
}

// Every schema reachable from the selected operations.
const used = new Set()
function collect(node) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach(collect)
    return
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      const name = refName(value)
      if (!used.has(name)) {
        used.add(name)
        collect(schemas[name])
      }
    } else {
      collect(value)
    }
  }
}
for (const { op } of operations) collect(op)

// ---------------------------------------------------------------- type helpers

const nullTypes = (schema) => Array.isArray(schema?.type) && schema.type.includes('null')
const isNullSchema = (schema) => schema?.type === 'null'

/** Splits `oneOf: [X, {type: null}]` and `type: [x, null]` into the schema and its nullability. */
function unwrapNullable(schema) {
  if (!schema) return { schema, nullable: false }
  for (const key of ['oneOf', 'anyOf']) {
    if (schema[key]) {
      const rest = schema[key].filter((s) => !isNullSchema(s))
      if (rest.length === 1 && rest.length < schema[key].length) {
        return { schema: { ...rest[0], description: schema.description }, nullable: true }
      }
    }
  }
  if (nullTypes(schema)) {
    const types = schema.type.filter((t) => t !== 'null')
    return { schema: { ...schema, type: types.length === 1 ? types[0] : types }, nullable: true }
  }
  return { schema, nullable: false }
}

const isEnumSchema = (schema) =>
  schema && (schema.type === 'string' || !schema.type) && Array.isArray(schema.enum)

/** Inline classes generated while walking properties: name -> definition. */
const inlineClasses = new Map()

function kotlinType(rawSchema, context) {
  const { schema, nullable } = unwrapNullable(rawSchema)
  const base = baseType(schema, context)
  return { type: base, nullable }
}

function baseType(schema, context) {
  if (!schema) return 'kotlinx.serialization.json.JsonElement'
  if (schema.$ref) return className(refName(schema.$ref))
  if (isEnumSchema(schema)) {
    const name = context.inlineName
    inlineClasses.set(name, {
      kind: 'enum',
      name,
      values: schema.enum,
      description: schema.description,
    })
    return name
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case 'string':
      if (schema.format === 'date-time') return 'Instant'
      if (schema.format === 'date') return 'LocalDate'
      return 'String'
    case 'integer':
      return schema.format === 'int64' ? 'Long' : 'Int'
    case 'number':
      return 'Double'
    case 'boolean':
      return 'Boolean'
    case 'array': {
      const item = kotlinType(schema.items, {
        ...context,
        inlineName: context.itemName ?? `${context.inlineName}Item`,
      })
      return `List<${item.type}${item.nullable ? '?' : ''}>`
    }
    case 'object': {
      if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object' &&
        !schema.properties
      ) {
        const value = kotlinType(schema.additionalProperties, {
          ...context,
          inlineName: `${context.inlineName}Value`,
        })
        return `Map<String, ${value.type}${value.nullable ? '?' : ''}>`
      }
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        const name = context.inlineName
        inlineClasses.set(name, { kind: 'object', name, schema })
        return name
      }
      return 'JsonObject'
    }
    default:
      if (schema.properties) {
        const name = context.inlineName
        inlineClasses.set(name, { kind: 'object', name, schema })
        return name
      }
      return 'kotlinx.serialization.json.JsonElement'
  }
}

// ---------------------------------------------------------------- rendering

const header = (imports) => {
  const lines = [
    '// Generated by scripts/generate-android-client.mjs from packages/api-contract/openapi.json.',
    '// Do not edit by hand: change the API contract and run `pnpm generate:android-client`.',
    '@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)',
    '',
    `package ${basePackage}.model`,
    '',
  ]
  const all = new Set([
    'com.khandanirishta.app.core.network.serialization.InstantSerializer',
    'com.khandanirishta.app.core.network.serialization.LocalDateSerializer',
    'kotlinx.serialization.UseSerializers',
    ...imports,
  ])
  for (const i of [...all].sort()) lines.push(`import ${i}`)
  return `${lines.join('\n')}\n\n`
}

function kdoc(text, indent = '') {
  if (!text) return ''
  const clean = text.replace(/\*\//g, '* /').trim()
  const lines = clean.split('\n').map((l) => l.trimEnd())
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`
  return `${indent}/**\n${lines.map((l) => `${indent} *${l ? ` ${l}` : ''}`).join('\n')}\n${indent} */\n`
}

function renderEnum(name, values, description) {
  const entries = values.map((v) => `    ${enumEntry(v)}("${v}"),`).join('\n')
  return (
    `${kdoc(description)}@Serializable(with = ${name}.Serializer::class)\n` +
    `enum class ${name}(override val wire: String) : WireEnum {\n` +
    `${entries}\n\n` +
    '    /** A value this build does not know yet (a newer API). */\n' +
    '    UNKNOWN(""),\n' +
    '    ;\n\n' +
    `    internal object Serializer : WireEnumSerializer<${name}>("${name}", ${name}.entries, UNKNOWN)\n` +
    '}\n'
  )
}

/** Properties of an object schema, merging `allOf` parts. */
function objectProperties(schema) {
  if (schema.allOf) {
    const merged = { properties: {}, required: [] }
    for (const part of schema.allOf) {
      const resolved = part.$ref ? schemas[refName(part.$ref)] : part
      const props = objectProperties(resolved)
      Object.assign(merged.properties, props.properties)
      merged.required.push(...props.required)
    }
    return merged
  }
  return { properties: schema.properties ?? {}, required: schema.required ?? [] }
}

function renderDataClass(name, schema, extra = {}) {
  const { properties, required } = objectProperties(schema)
  const requiredSet = new Set(required)
  const fields = []
  for (const [wire, propSchema] of Object.entries(properties)) {
    if (extra.constant && wire === extra.constant.field) {
      fields.push(
        `    @SerialName("${wire}")\n    val ${safeName(camel(wire))}: String = "${extra.constant.value}",`,
      )
      continue
    }
    const inlineName = `${name}${pascal(wire)}`
    const itemName =
      /^Page/.test(name) || name.endsWith('Page') ? name.replace(/Page$/, '') : undefined
    const { type, nullable } = kotlinType(propSchema, {
      inlineName,
      itemName: wire === 'items' && itemName ? itemName : undefined,
    })
    const optional = !requiredSet.has(wire)
    const isNullable = nullable || optional
    const doc = kdoc(
      propSchema.description ?? unwrapNullable(propSchema).schema?.description,
      '    ',
    )
    fields.push(
      `${doc}    @SerialName("${wire}")\n    val ${safeName(camel(wire))}: ${type}${isNullable ? '? = null' : ''},`,
    )
  }
  if (fields.length === 0) {
    return `${kdoc(schema.description)}@Serializable\nclass ${name}\n`
  }
  return `${kdoc(schema.description)}@Serializable\ndata class ${name}(\n${fields.join('\n')}\n)\n`
}

const IMPORTS = [
  'com.khandanirishta.app.core.network.serialization.WireEnum',
  'com.khandanirishta.app.core.network.serialization.WireEnumSerializer',
  'java.time.Instant',
  'java.time.LocalDate',
  'kotlinx.serialization.SerialName',
  'kotlinx.serialization.Serializable',
  'kotlinx.serialization.json.JsonObject',
]

function usedImports(body) {
  return IMPORTS.filter((i) => {
    const simple = i.split('.').pop()
    return new RegExp(`\\b${simple}\\b`).test(body)
  })
}

const files = new Map() // relative path -> content
const unionVariants = new Map() // schema name -> [{ className, suffix }]

function emitModel(name, body) {
  files.set(`model/${name}.kt`, `${header(usedImports(body))}${body}`)
}

for (const schemaName of [...used].sort()) {
  const schema = schemas[schemaName]
  const name = className(schemaName)
  if (isEnumSchema(schema)) {
    emitModel(name, renderEnum(name, schema.enum, schema.description))
    continue
  }
  const variants = schema.oneOf ?? schema.anyOf
  if (variants && !schema.properties) {
    // A union request body. Each variant gets its own class and its own API method, because the
    // API tells them apart by the path or by a constant field, not by a type tag.
    const list = []
    for (const variant of variants) {
      if (variant.$ref) {
        const variantClass = className(refName(variant.$ref))
        list.push({ className: variantClass, suffix: variantClass.replace(/(Section|Body)$/, '') })
        continue
      }
      const constant = Object.entries(variant.properties ?? {}).find(
        ([, p]) => Array.isArray(p.enum) && p.enum.length === 1,
      )
      const suffix = constant ? pascal(constant[1].enum[0]) : `Variant${list.length + 1}`
      const variantName = `${name}${suffix}`
      emitModel(
        variantName,
        renderDataClass(
          variantName,
          variant,
          constant ? { constant: { field: constant[0], value: constant[1].enum[0] } } : {},
        ),
      )
      list.push({ className: variantName, suffix })
    }
    unionVariants.set(schemaName, list)
    continue
  }
  emitModel(name, renderDataClass(name, schema))
}

// Inline classes found while rendering (they can themselves contain inline classes).
const emittedInline = new Set()
let pending = [...inlineClasses.values()]
while (pending.length) {
  for (const def of pending) {
    if (emittedInline.has(def.name)) continue
    emittedInline.add(def.name)
    if (def.kind === 'enum') emitModel(def.name, renderEnum(def.name, def.values, def.description))
    else emitModel(def.name, renderDataClass(def.name, def.schema))
  }
  pending = [...inlineClasses.values()].filter((d) => !emittedInline.has(d.name))
}

// ---------------------------------------------------------------- API interfaces

function responseType(op) {
  const ok = Object.entries(op.responses ?? {}).filter(([code]) => code.startsWith('2'))
  const withBody = ok
    .map(([, r]) => r.content && Object.values(r.content)[0]?.schema)
    .filter(Boolean)
  if (withBody.length === 0) return 'Unit'
  const { schema, nullable } = unwrapNullable(withBody[0])
  // Retrofit cannot see Kotlin nullability, so a body that may be `null` is read as JSON.
  if (nullable) return 'JsonElement'
  return baseType(schema, { inlineName: `${pascal(op.operationId)}Response` })
}

const byTag = new Map()
for (const entry of operations) {
  if (!byTag.has(entry.tag)) byTag.set(entry.tag, [])
  byTag.get(entry.tag).push(entry)
}

for (const [tag, entries] of [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const apiName = `${pascal(tag)}Api`
  const methods = []
  for (const { path, method, op } of entries.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  )) {
    const params = []
    for (const p of op.parameters ?? []) {
      const { type, nullable } = kotlinType(p.schema, {
        inlineName: `${pascal(op.operationId)}${pascal(p.name)}`,
      })
      // Query enums travel as their wire strings.
      const inner = unwrapNullable(p.schema).schema
      const resolved = inner?.$ref ? schemas[refName(inner.$ref)] : inner
      const kotlin = isEnumSchema(resolved) ? 'String' : type
      const name = safeName(camel(p.name))
      if (p.in === 'path') params.push(`@Path("${p.name}") ${name}: String`)
      else if (p.in === 'query') {
        params.push(
          p.required && !nullable
            ? `@Query("${p.name}") ${name}: ${kotlin}`
            : `@Query("${p.name}") ${name}: ${kotlin}? = null`,
        )
      } else if (p.in === 'header') {
        params.push(`@Header("${p.name}") ${name}: String? = null`)
      }
    }
    const result = responseType(op)
    const doc = kdoc(
      [op.summary, `\`${method.toUpperCase()} ${path}\``].filter(Boolean).join('\n\n'),
      '    ',
    )
    const annotation = `@${method.toUpperCase()}("${path.replace(/^\//, '')}")`
    const bodySchema = op.requestBody && Object.values(op.requestBody.content)[0]?.schema
    const bodyName = bodySchema?.$ref ? refName(bodySchema.$ref) : null
    const fn = camel(op.operationId)
    if (bodyName && unionVariants.has(bodyName)) {
      for (const variant of unionVariants.get(bodyName)) {
        methods.push(
          `${doc}    ${annotation}\n    suspend fun ${fn}${variant.suffix}(\n${[
            ...params,
            `@Body body: ${variant.className}`,
          ]
            .map((p) => `        ${p},`)
            .join('\n')}\n    ): Response<${result}>\n`,
        )
      }
      continue
    }
    if (bodySchema) {
      const bodyType = bodyName
        ? className(bodyName)
        : baseType(bodySchema, { inlineName: `${pascal(op.operationId)}Body` })
      params.push(`@Body body: ${bodyType}`)
    }
    const signature = params.length
      ? `(\n${params.map((p) => `        ${p},`).join('\n')}\n    )`
      : '()'
    methods.push(
      `${doc}    ${annotation}\n    suspend fun ${fn}${signature}: Response<${result}>\n`,
    )
  }
  const body = methods.join('\n')
  const imports = new Set([
    'retrofit2.Response',
    ...['Body', 'DELETE', 'GET', 'Header', 'PATCH', 'POST', 'PUT', 'Path', 'Query']
      .filter((a) => new RegExp(`@${a}\\b`).test(body))
      .map((a) => `retrofit2.http.${a}`),
  ])
  if (/\bJsonElement\b/.test(body)) imports.add('kotlinx.serialization.json.JsonElement')
  if (/\bJsonObject\b/.test(body)) imports.add('kotlinx.serialization.json.JsonObject')
  const modelRefs = new Set(body.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? [])
  for (const file of files.keys()) {
    const model = file.replace(/^model\//, '').replace(/\.kt$/, '')
    if (modelRefs.has(model)) imports.add(`${basePackage}.model.${model}`)
  }
  const content = [
    '// Generated by scripts/generate-android-client.mjs from packages/api-contract/openapi.json.',
    '// Do not edit by hand: change the API contract and run `pnpm generate:android-client`.',
    '',
    `package ${basePackage}.api`,
    '',
    ...[...imports].sort().map((i) => `import ${i}`),
    '',
    `/** Endpoints tagged \`${tag}\` in the API contract. */`,
    `interface ${apiName} {`,
    body.trimEnd(),
    '}',
    '',
  ].join('\n')
  files.set(`api/${apiName}.kt`, content)
}

// ---------------------------------------------------------------- write or check

function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listFiles(join(dir, d.name)) : [join(dir, d.name)],
  )
}

if (check) {
  const existing = new Map(
    listFiles(outDir).map((f) => [
      relative(outDir, f).replaceAll('\\', '/'),
      readFileSync(f, 'utf8'),
    ]),
  )
  const problems = []
  for (const [rel, content] of files) {
    if (existing.get(rel) !== content) problems.push(`changed or missing: ${rel}`)
  }
  for (const rel of existing.keys()) if (!files.has(rel)) problems.push(`stale: ${rel}`)
  if (problems.length) {
    console.error(
      'The generated Android client is out of date. Run `pnpm generate:android-client`.',
    )
    for (const p of problems.slice(0, 20)) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`Android client is up to date (${files.size} files).`)
} else {
  // Remove stale files and rewrite only changed ones, so Gradle recompiles as little as possible.
  let written = 0
  let removed = 0
  for (const file of listFiles(outDir)) {
    if (!files.has(relative(outDir, file).replaceAll('\\', '/'))) {
      rmSync(file)
      removed += 1
    }
  }
  for (const [rel, content] of files) {
    const target = join(outDir, rel)
    if (existsSync(target) && readFileSync(target, 'utf8') === content) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
    written += 1
  }
  console.log(
    `${files.size} files in ${relative(root, outDir).replaceAll('\\', '/')}: ${written} written, ${removed} removed`,
  )
}
