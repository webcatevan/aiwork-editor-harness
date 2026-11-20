/**
 * Minimal ambient declarations for the DSH host surface this package touches.
 *
 * The library is built by the bundle's Vite config into one self-contained ESM
 * file, so it imports no `@deepseek-ai/*` package at runtime (an installed
 * bundle cannot resolve them). These declarations keep `tsc --noEmit` useful
 * without a local install of the harness.
 *
 * @module harness-textbook-library/vendor
 */

declare module '@deepseek-ai/cordis' {
  export interface FetchRoute {
    path: string
    methods: readonly ('GET' | 'HEAD' | 'POST')[]
    requestBody: 'buffered' | 'streaming'
    fetch: (request: Request) => Promise<Response>
  }

  export interface RuntimeSkill {
    name: string
    description: string
    content: string
    path?: string
    resourceBase?:
      | { kind: 'directory'; path: string }
      | { kind: 'url'; url: string }
      | { kind: 'opaque'; description: string }
  }

  export type Context = {
    tools: { register: (tool: unknown) => void }
    connection: {
      fetch: {
        register: (route: FetchRoute) => () => void | Promise<void>
      }
    }
    skills: { register: (skill: RuntimeSkill) => (() => void) }
    /** Optional service lookup, for the Agent's default model route. */
    get?: (name: string) => unknown
    llm: {
      prepareCall: (
        route: { provider: string; model: string; maxTokens?: number },
        signal?: AbortSignal,
        adjust?: (controls: unknown, model: { reasoning?: { efforts?: readonly { id: string }[] } }) => unknown,
      ) => Promise<{ config: unknown; stream: (options: unknown) => AsyncIterable<{ type: string; text?: string }> }>
    }
    effect: (execute: () => void | (() => void | Promise<void>), label?: string) => unknown
    provide?: (name: string, value: unknown) => unknown
    set?: (name: string, value: unknown) => void
    logger?: { warn?: (message: string, ...args: unknown[]) => void }
    textbookLibrary?: import('./textbook-library.js').TextbookLibrary
  }
}
