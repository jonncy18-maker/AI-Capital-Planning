// Currency stays in integer cents until the final aggregate is returned.
export const MAX_ITEM_AMOUNT = 10000000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) { return typeof value === 'string' && UUID.test(value) }

export function isBillAmountItemsEligible(bill) {
  return !!bill && bill.fixed_amount == null && bill.forecast_category_id == null
    && bill.actuals_category == null && bill.credit_card_id == null
}

export function amountToCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_ITEM_AMOUNT
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new Error('Item amount must be between $0 and $10,000,000 with at most two decimal places.')
  }
  return Math.round(amount * 100)
}

export function normalizeBillAmountItems(items) {
  if (!Array.isArray(items) || items.length > 100) throw new Error('Provide an item list with at most 100 items.')
  const ids = new Set()
  return items.map(item => {
    if (!item || !isUuid(item.id)) throw new Error('Each item needs a valid UUID.')
    const id = item.id.toLowerCase()
    if (ids.has(id)) throw new Error('Item IDs must be unique.')
    ids.add(id)
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 200) {
      throw new Error('Each item needs a name of 1–200 characters.')
    }
    return { id, name: item.name.trim(), amount: amountToCents(item.amount) / 100 }
  })
}

export function totalBillAmountItems(items) {
  return normalizeBillAmountItems(items).reduce((sum, item) => sum + amountToCents(item.amount), 0) / 100
}

export function initialBillAmountItems(row, createId = () => globalThis.crypto.randomUUID()) {
  if (row?.items != null) return normalizeBillAmountItems(row.items)
  const amount = Number(row?.amount ?? 0)
  return amount === 0 ? [] : normalizeBillAmountItems([{ id: createId(), name: 'Existing amount', amount }])
}
