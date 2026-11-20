import workshopCss from './workshop.css?inline'

export const WORKSHOP_STYLE_ID = 'smart-edit-workshop-styles'

/** Inject workshop layout CSS once (Vite inlines `?inline` at bundle build). */
export function ensureWorkshopStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(WORKSHOP_STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = WORKSHOP_STYLE_ID
  tag.textContent = workshopCss
  document.head.appendChild(tag)
}