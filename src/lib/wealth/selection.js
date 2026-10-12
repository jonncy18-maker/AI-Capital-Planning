const selectionKey = (userId) => `wealth:selected-plan:${encodeURIComponent(userId)}`

export function readSelectedPlanId(userId, storage) {
  if (!userId) return ''
  try {
    return (storage ?? globalThis.localStorage)?.getItem(selectionKey(userId)) || ''
  } catch {
    return ''
  }
}

export function storeSelectedPlanId(userId, id, storage) {
  if (!userId) return
  try {
    const target = storage ?? globalThis.localStorage
    if (id) target?.setItem(selectionKey(userId), id)
    else target?.removeItem(selectionKey(userId))
  } catch {
    // Restricted browser storage must not block plan selection in this session.
  }
}

export function resolveSelectedPlanId(plans, preferredId) {
  return plans.some((plan) => plan.id === preferredId) ? preferredId : plans[0]?.id || ''
}
