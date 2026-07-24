// Pure helper: turn an income-change input into month-by-month gross/net delta
// rows (ready to persist as scenario_income_adjustments) plus a preview summary.
//
// Net is derived the same way the dashboard income forecast is
// (widgetData.js#incomeVsExpenses): net = gross − tax − 401k, using the user's
// effective tax rate and 401k %. Benefits are deliberately NOT applied to a
// change — they're fixed premiums, not a function of a raise/bonus — which keeps
// the math transparent. Everything here is deterministic and side-effect free so
// the UI preview and the persisted rows always agree.

const clampMonth = (m) => Math.min(12, Math.max(1, Math.round(Number(m) || 1)))

// taxCtx: { effectiveRate: 0..1, four01kPct: number (percent) }
function netOf(gross, { taxable, applies401k }, taxCtx) {
  const effRate = Number(taxCtx?.effectiveRate) || 0
  const k401Pct = Number(taxCtx?.four01kPct) || 0
  const tax = taxable ? gross * effRate : 0
  const k401 = applies401k ? gross * (k401Pct / 100) : 0
  return { net: gross - tax - k401, tax, k401 }
}

// input shapes (all amounts are GROSS annual/monthly/lump as noted):
//   salary:    { type:'salary', year, startMonth, newAnnualGross, oldAnnualGross }
//   bonus:     { type:'bonus', year, month, grossAmount, applies401k }
//   recurring: { type:'recurring', year, startMonth, endMonth, monthlyGross, taxable }
//   windfall:  { type:'windfall', year, month, grossAmount, taxable }
export function computeIncomeScenarioRows(input, taxCtx) {
  const year = Math.round(Number(input?.year) || new Date().getFullYear())
  const type = input?.type
  const rows = []
  const totals = { grossTotal: 0, netTotal: 0, taxTotal: 0, k401Total: 0 }

  const push = (month, gross, opts, label) => {
    const { net, tax, k401 } = netOf(gross, opts, taxCtx)
    rows.push({
      year,
      month: clampMonth(month),
      income_type: type,
      gross_amount: gross,
      net_amount: net,
      taxable: !!opts.taxable,
      label: label || '',
    })
    totals.grossTotal += gross
    totals.netTotal += net
    totals.taxTotal += tax
    totals.k401Total += k401
  }

  if (type === 'salary') {
    const monthlyGross = ((Number(input.newAnnualGross) || 0) - (Number(input.oldAnnualGross) || 0)) / 12
    const start = clampMonth(input.startMonth)
    for (let m = start; m <= 12; m++) {
      push(m, monthlyGross, { taxable: true, applies401k: true }, input.label)
    }
  } else if (type === 'bonus') {
    push(input.month, Number(input.grossAmount) || 0,
      { taxable: true, applies401k: !!input.applies401k }, input.label)
  } else if (type === 'recurring') {
    const start = clampMonth(input.startMonth)
    const end = clampMonth(input.endMonth ?? 12)
    const taxable = input.taxable !== false
    for (let m = start; m <= end; m++) {
      push(m, Number(input.monthlyGross) || 0, { taxable, applies401k: false }, input.label)
    }
  } else if (type === 'windfall') {
    const taxable = input.taxable === true // windfalls default to non-taxable (refund/gift)
    push(input.month, Number(input.grossAmount) || 0,
      { taxable, applies401k: false }, input.label)
  }

  return {
    rows,
    summary: {
      monthsAffected: rows.length,
      grossTotal: totals.grossTotal,
      netTotal: totals.netTotal,
      taxTotal: totals.taxTotal,
      k401Total: totals.k401Total,
      effectiveRatePct: Math.round((Number(taxCtx?.effectiveRate) || 0) * 100),
      four01kPct: Number(taxCtx?.four01kPct) || 0,
    },
  }
}

// Net income delta per calendar month (0-indexed Jan..Dec) for a single year,
// summed across a set of income-adjustment rows. Used to fold committed income
// scenarios into the forecast.
export function netByMonthForYear(rows, year) {
  const out = Array(12).fill(0)
  for (const r of rows || []) {
    if (Math.round(Number(r.year)) !== year) continue
    const idx = clampMonth(r.month) - 1
    out[idx] += Number(r.net_amount) || 0
  }
  return out
}
