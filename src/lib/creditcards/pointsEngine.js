// ─── Points Forecast Engine ───────────────────────────────────────────────────
//
// Computes monthly points earning forecast by:
//   1. Resolving monthly spend per budget category (override → line items → 0)
//   2. Skipping cash_only categories
//   3. Applying coveragePct: % of remaining spend that goes on a card
//   4. Routing spend to best card (optimizationPct) vs. default card (1 - optimizationPct)
//   5. Applying earn rates to get points per month per card
//
// Returns:
//   monthlyForecast: Array<{ month, byCard: { [cardId]: points }, total: points }>
//   runningBalance:  Array<{ month, byCard: { [cardId]: balance }, total: balance }>
//
// Caller must pass pre-loaded data to keep this function pure and testable.

export const CC_CATEGORIES = [
  { slug: 'dining',          label: 'Dining' },
  { slug: 'travel',          label: 'Travel' },
  { slug: 'groceries',       label: 'Groceries' },
  { slug: 'gas',             label: 'Gas & EV Charging' },
  { slug: 'streaming',       label: 'Streaming & Subscriptions' },
  { slug: 'transit',         label: 'Transit & Rideshare' },
  { slug: 'online_shopping', label: 'Online Shopping' },
  { slug: 'drugstore',       label: 'Drugstore & Pharmacy' },
  { slug: 'other',           label: 'Everything Else' },
]

// Build the lookup maps used to resolve monthly spend per category.
//   lineItemsByCategory[categoryId][month] = summed budget_line_items amount
//   overridesByCategory[categoryId][month] = forecast_override amount
export function buildSpendMaps(lineItems, overrides) {
  const lineItemsByCategory = {}
  for (const li of (lineItems ?? [])) {
    if (!lineItemsByCategory[li.category_id]) lineItemsByCategory[li.category_id] = {}
    lineItemsByCategory[li.category_id][li.month] =
      (lineItemsByCategory[li.category_id][li.month] ?? 0) + Number(li.amount)
  }

  const overridesByCategory = {}
  for (const ov of (overrides ?? [])) {
    if (!overridesByCategory[ov.category_id]) overridesByCategory[ov.category_id] = {}
    overridesByCategory[ov.category_id][ov.month] = Number(ov.amount)
  }

  return { lineItemsByCategory, overridesByCategory }
}

// Resolve spend per category for a given month.
// Priority: forecast_override → sum(budget_line_items) → 0
export function resolveMonthlySpend(categoryId, month, lineItemsByCategory, overridesByCategory) {
  if (overridesByCategory[categoryId]?.[month] != null) {
    return Number(overridesByCategory[categoryId][month])
  }
  return lineItemsByCategory[categoryId]?.[month] ?? 0
}

// Find the best earn rate for a given cc_category across all active cards.
// Returns { cardId, earnRate } or null if no cards have earn rates configured.
export function bestCardForCategory(ccCategory, cards, earnRateMap) {
  let best = null
  for (const card of cards) {
    const rates = earnRateMap[card.id] ?? {}
    // Fall back to 'other' earn rate if the specific category isn't configured
    const rate = rates[ccCategory] ?? rates['other'] ?? 1.0
    if (!best || rate > best.earnRate) {
      best = { cardId: card.id, earnRate: rate }
    }
  }
  return best
}

// Get the default card's earn rate for a given cc_category.
export function defaultCardRate(ccCategory, defaultCard, earnRateMap) {
  if (!defaultCard) return 1.0
  const rates = earnRateMap[defaultCard.id] ?? {}
  return rates[ccCategory] ?? rates['other'] ?? 1.0
}

export function computePointsForecast({
  cards,            // credit_cards rows (active)
  earnRateMap,      // { [cardId]: { [cc_category]: rate } }
  budgetCategories, // budget_categories rows (with cc_category, cash_only)
  lineItems,        // budget_line_items rows for the year
  overrides,        // forecast_overrides rows for the year
  pointsBalances,   // { [cardId]: { balance } } — latest snapshot per card
  redemptions,      // credit_card_point_redemptions rows for the year
  coveragePct,      // 0–100: % of eligible spend that goes on a card
  optimizationPct,  // 0–100: % of card spend routed to best card (rest → default)
  year,
}) {
  if (!cards || cards.length === 0) {
    return { monthlyForecast: [], runningBalance: [] }
  }

  const defaultCard = cards.find(c => c.is_default) ?? cards[0]
  const coverageFactor = (coveragePct ?? 80) / 100
  const optimizationFactor = (optimizationPct ?? 100) / 100

  // Build lookup maps for line items and overrides
  const { lineItemsByCategory, overridesByCategory } = buildSpendMaps(lineItems, overrides)

  // Build redemptions map: { [cardId]: { [month]: pointsAmount } }
  const redemptionMap = {}
  for (const r of (redemptions ?? [])) {
    if (!redemptionMap[r.card_id]) redemptionMap[r.card_id] = {}
    redemptionMap[r.card_id][r.month] =
      (redemptionMap[r.card_id][r.month] ?? 0) + r.points_amount
  }

  // Initialize running balances from latest snapshots
  const runningBal = {}
  for (const card of cards) {
    runningBal[card.id] = pointsBalances[card.id]?.balance ?? 0
  }

  const monthlyForecast = []
  const runningBalance = []

  for (let month = 1; month <= 12; month++) {
    const earnedByCard = {}
    for (const card of cards) earnedByCard[card.id] = 0

    // Accumulate points earned for each budget category this month
    for (const cat of budgetCategories) {
      if (cat.cash_only) continue
      if (!cat.is_active) continue

      const spend = resolveMonthlySpend(cat.id, month, lineItemsByCategory, overridesByCategory)
      if (spend <= 0) continue

      const cardableSpend = spend * coverageFactor
      const ccCat = cat.cc_category || 'other'

      const best = bestCardForCategory(ccCat, cards, earnRateMap)
      const defRate = defaultCardRate(ccCat, defaultCard, earnRateMap)

      const optimizedSpend = cardableSpend * optimizationFactor
      const defaultSpend = cardableSpend * (1 - optimizationFactor)

      if (best) {
        earnedByCard[best.cardId] = (earnedByCard[best.cardId] ?? 0) + optimizedSpend * best.earnRate
      }
      earnedByCard[defaultCard.id] =
        (earnedByCard[defaultCard.id] ?? 0) + defaultSpend * defRate
    }

    // Round to whole points
    const roundedEarned = {}
    let monthTotal = 0
    for (const card of cards) {
      roundedEarned[card.id] = Math.round(earnedByCard[card.id] ?? 0)
      monthTotal += roundedEarned[card.id]
    }

    monthlyForecast.push({ month, byCard: roundedEarned, total: monthTotal })

    // Apply earned points and redemptions to running balance
    const balSnapshot = {}
    let balTotal = 0
    for (const card of cards) {
      const redeemed = redemptionMap[card.id]?.[month] ?? 0
      runningBal[card.id] = Math.max(0, (runningBal[card.id] ?? 0) + roundedEarned[card.id] - redeemed)
      balSnapshot[card.id] = runningBal[card.id]
      balTotal += runningBal[card.id]
    }

    runningBalance.push({ month, byCard: balSnapshot, total: balTotal })
  }

  return { monthlyForecast, runningBalance }
}

// Estimate total dollar value across all cards at current balances
export function estimateTotalValue(cards, pointsBalances) {
  let total = 0
  for (const card of cards) {
    const bal = pointsBalances[card.id]?.balance ?? 0
    const centsPerPoint = card.points_value_cents ?? 1.0
    total += bal * centsPerPoint / 100
  }
  return total
}

// Estimate monthly earning rate (average points/month over 12-month forecast)
export function estimateMonthlyEarnRate(monthlyForecast) {
  if (!monthlyForecast || monthlyForecast.length === 0) return 0
  const total = monthlyForecast.reduce((s, m) => s + m.total, 0)
  return Math.round(total / monthlyForecast.length)
}
