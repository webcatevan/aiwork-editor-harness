declare module '@deepseek-ai/cordis' {
  export type Context = {
    slots: {
      register: (spec: unknown, component: unknown) => () => void
    }
    effect: (fn: () => void | (() => void)) => void
    textbookLibrary?: unknown
  }
}