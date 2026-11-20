/**
 * Tool definitions without a host import.
 *
 * A third-party bundle installed into a profile cannot import
 * `@deepseek-ai/dsh-tools`: the profile resolves the bundle's own entry, but a
 * package there has no access to the host's private node_modules tree. So this
 * module reproduces the small authoring surface the host accepts — the JSON
 * Schema projection of the parameter DSL and the `output { schema, render }`
 * shape `ctx.tools.register()` validates — and nothing else.
 *
 * The projection matches `defineTool` exactly for the DSL subset in use:
 * an implicit open object root, per-property `required: true`, and `type:
 * 'json'` → `{}` (see `packages/core/tools/src/schema.ts` in DSH).
 *
 * @module harness-textbook-library/tool-def
 */

/** One authored parameter property. */
export interface ParameterSpec {
  /** JSON value kind; `json` means any lossless JSON value (`{}` schema). */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object' | 'json'
  /** Model-facing description. */
  description?: string
  /** Annotation only; forwarded to the JSON Schema. */
  title?: string
  /** Lossless annotation. */
  default?: unknown
  /** Lossless annotation. */
  examples?: unknown
  enum?: readonly unknown[]
  const?: unknown
  required?: true
  /** Array element schema. */
  items?: ParameterSpec
  /** Nested object properties. */
  properties?: Record<string, ParameterSpec>
  /** Nested object openness. */
  additionalProperties?: boolean
  oneOf?: readonly ParameterSpec[]
}

/** A tool body the host's tool pipeline accepts. */
export interface ToolDefinitionLike {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => { type: 'text'; text: string }[]
  }
  execute: (args: unknown, exec?: unknown) => Promise<unknown>
}

/** Copy the annotations the host projects into JSON Schema. */
function annotations(spec: ParameterSpec): Record<string, unknown> {
  const carried: Record<string, unknown> = {}
  if (spec.description !== undefined) carried.description = spec.description
  if (spec.title !== undefined) carried.title = spec.title
  if (spec.default !== undefined) carried.default = spec.default
  if (spec.examples !== undefined) carried.examples = spec.examples
  if (spec.enum !== undefined) carried.enum = spec.enum
  if (spec.const !== undefined) carried.const = spec.const
  return carried
}

/** Project one authoring property into its JSON Schema node. */
export function toJsonSchema(spec: ParameterSpec): Record<string, unknown> {
  if (spec.type === 'json') return annotations(spec)
  if (spec.oneOf !== undefined) return { ...annotations(spec), oneOf: spec.oneOf.map(toJsonSchema) }
  if (spec.type === 'object') {
    const node: Record<string, unknown> = {
      type: 'object',
      additionalProperties: spec.additionalProperties ?? false,
      ...annotations(spec),
    }
    if (spec.properties !== undefined) {
      const required = Object.entries(spec.properties)
        .filter(([, property]) => property.required === true)
        .map(([name]) => name)
      node.properties = Object.fromEntries(
        Object.entries(spec.properties).map(([name, property]) => [name, toJsonSchema(property)]),
      )
      if (required.length > 0) node.required = required
    }
    return node
  }
  if (spec.type === 'array') {
    return {
      ...(spec.items === undefined ? {} : { items: toJsonSchema(spec.items) }),
      type: 'array',
      ...annotations(spec),
    }
  }
  return { ...(spec.type === undefined ? {} : { type: spec.type }), ...annotations(spec) }
}

/**
 * Project an implicit parameter map into the open object root the host sends to
 * the model, dropping each property's authoring-only `required` flag.
 * @param parameters - authored properties.
 * @returns the JSON Schema object root.
 */
export function parameterRoot(parameters: Record<string, ParameterSpec>): Record<string, unknown> {
  const required = Object.entries(parameters)
    .filter(([, property]) => property.required === true)
    .map(([name]) => name)
  const root: Record<string, unknown> = {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(parameters).map(([name, property]) => [name, toJsonSchema(property)]),
    ),
  }
  if (required.length > 0) root.required = required
  return root
}

/** One model-facing JSON rendering of a tool result. */
function renderJson(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }]
}

/**
 * Build the definition `ctx.tools.register()` accepts, mirroring
 * `defineTool({ description, parameters, output: { schema: { type: 'json' } }, execute })`.
 * @param spec - name, description, authored parameters, and the body.
 * @returns a tool definition with an open JSON output schema.
 */
export function defineJsonTool(spec: {
  name: string
  description: string
  parameters: Record<string, ParameterSpec>
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>
}): ToolDefinitionLike {
  return {
    name: spec.name,
    description: spec.description,
    parameters: parameterRoot(spec.parameters),
    output: { schema: {}, render: (_args, value) => renderJson(value) },
    execute: async (args: unknown) => spec.execute((args ?? {}) as Record<string, unknown>),
  }
}
