/**
 * Read-only card for an unknown block node.
 *
 * The harness documents carry interactive module blocks (`examQuestion`,
 * `chemRust`, …) whose real editors live in FutureEditor. The panel keeps them
 * intact — every attribute is preserved on save — and shows what the block is,
 * with its config available for inspection.
 *
 * @module harness-client-smart-edit/client/ModuleBlockCard
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

/** When config was saved from this card. */
export const MODULE_CONFIG_SAVE_EVENT = 'se:update-module-config'

/** Pretty-print one attribute value for the details pane. */
function format(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** The block's readable config, when it has one. */
function configOf(attrs: Record<string, unknown>): Record<string, unknown> | undefined {
  const config = attrs.config
  return typeof config === 'object' && config !== null && !Array.isArray(config)
    ? config as Record<string, unknown>
    : undefined
}

/**
 * Render one preserved module block.
 * @param props - Tiptap node-view props, including the node's attributes.
 * @returns the card.
 */
export function ModuleBlockCard({ node, selected, updateAttributes }: NodeViewProps): ReactNode {
  const attrs = node.attrs as Record<string, unknown>
  const config = configOf(attrs)
  const blockId = typeof attrs.blockId === 'string' ? attrs.blockId : undefined
  const keys = config === undefined ? [] : Object.keys(config)
  const initialDraft = useMemo(() => (config === undefined ? '{}' : format(config)), [config])
  const [draft, setDraft] = useState(initialDraft)
  const [editOpen, setEditOpen] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setDraft(initialDraft)
  }, [initialDraft])

  const applyLocal = (next: Record<string, unknown>): void => {
    updateAttributes({ config: next })
  }

  const onApplyConfig = (): void => {
    setSaveError('')
    let parsed: Record<string, unknown>
    try {
      const raw = JSON.parse(draft) as unknown
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        setSaveError('配置必须是 JSON 对象')
        return
      }
      parsed = raw as Record<string, unknown>
    } catch {
      setSaveError('JSON 格式错误')
      return
    }
    applyLocal(parsed)
  }

  const onSaveToServer = (): void => {
    onApplyConfig()
    if (!blockId) return
    const raw = draft
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      globalThis.dispatchEvent(new CustomEvent(MODULE_CONFIG_SAVE_EVENT, {
        detail: { blockId, config: parsed },
      }))
    } catch {
      setSaveError('JSON 格式错误')
    }
  }

  return (
    <NodeViewWrapper
      className="se-module"
      data-block-type={node.type.name}
      style={{
        border: `1px solid ${selected ? 'var(--dsw-alias-border-strong, #6b8afd)' : 'var(--dsw-alias-border, #3a3a3a)'}`,
        borderRadius: 6,
        padding: '8px 10px',
        margin: '8px 0',
        background: 'color-mix(in srgb, currentColor 4%, transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>互动模块</span>
        <strong style={{ fontSize: 13 }}>{node.type.name}</strong>
        {blockId ? <code style={{ fontSize: 11, opacity: 0.6 }}>{blockId}</code> : null}
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.55 }}>
          {keys.length > 0 ? `${keys.length} 项配置` : '无配置'}
        </span>
        <button
          type="button"
          className="se-module-edit-btn"
          onClick={() => setEditOpen((open) => !open)}
        >
          {editOpen ? '收起' : '配置'}
        </button>
      </div>
      {editOpen ? (
        <div className="se-module-config-edit">
          <textarea
            className="se-module-config-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={8}
            spellCheck={false}
          />
          {saveError ? <p className="se-module-config-err">{saveError}</p> : null}
          <div className="se-module-config-actions">
            <button type="button" className="fe-workshop-btn" onClick={onApplyConfig}>
              应用到文档
            </button>
            <button type="button" className="fe-workshop-btn" onClick={onSaveToServer}>
              保存到书库
            </button>
          </div>
        </div>
      ) : config !== undefined ? (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>查看配置</summary>
          <pre style={{ margin: '6px 0 0', fontSize: 11, maxHeight: 200, overflow: 'auto', opacity: 0.85 }}>
            {format(config)}
          </pre>
        </details>
      ) : null}
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.5 }}>
        修改 config 后点「应用到文档」并保存章节，或点「保存到书库」直接写入。
      </div>
    </NodeViewWrapper>
  )
}