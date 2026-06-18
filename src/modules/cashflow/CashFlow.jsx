import { useState, useEffect, useCallback } from 'react'
import { getTransactionsByMonth } from '../../lib/db/transactions.js'
import { getCommitments } from '../../lib/db/commitments.js'
import { getBudgetLineItems } from '../../lib/db/budgetLineItems.js'
import { commitmentMonthlyDemand, describeCostStructure } from '../../lib/commitments/schedule.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMoney(n) {
  if (Math.abs(n) >= 1000) return '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  return '$' + Math.round(Math.abs(n)).toLocaleString()
}

function fmtMoneyFull(n) {
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString()
}

// Build array of 12 trailing months (oldest first), ending on the current month.
function buildTrailingRange() {
  const now = new Date()
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    })
  }
  return months
}

// Build array of 12 forward months (current month first), looking ahead.
function buildForwardRange() {
  const now = new Date()
  const months = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    })
  }
  return months
}

// Aggregate raw transactions into monthly buckets (Actuals view).
function aggregateByMonth(transactions, monthRange) {
  return monthRange.map(({ year, month, label }) => {
    const rows = transactions.filter(t => {
      const d = new Date(t.date)
      return d.getFullYear() === year && d.getMonth() + 1 === month
    })
    const totalOut = rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0)
    const totalIn = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0)
    const net = totalIn + totalOut // totalOut is negative

    // Group by category
    const catMap = {}
    rows.forEach(r => {
      const key = r.category || 'Uncategorized'
      if (!catMap[key]) catMap[key] = { category: key, group: r.group, total: 0 }
      catMap[key].total += r.amount
    })
    const byCategory = Object.values(catMap).sort((a, b) => a.total - b.total) // most negative first

    return {
      year,
      month,
      label,
      totalOut: Math.abs(totalOut),
      totalIn,
      net,
      byCategory,
      txCount: rows.length,
    }
  })
}

// Aggregate planned cash demand (commitments + Non-Monthly budget items) by month.
// Commitments come from the shared schedule helper; budget line items are
// filtered to Non-Monthly categories and exclude commitment-sourced rows to
// avoid double-counting with the commitment layer.
function aggregatePlannedByMonth(commitments, lineItems, monthRange) {
  // Index Non-Monthly, non-commitment budget line items by `${year}-${month}`.
  const budgetByMonth = {}
  for (const li of lineItems) {
    const cat = li.budget_categories || {}
    if (cat.type !== 'Non-Monthly') continue
    if (li.commitment_id) continue // surfaced via the commitment layer instead
    const key = `${li.budget_year}-${li.month}`
    if (!budgetByMonth[key]) budgetByMonth[key] = []
    budgetByMonth[key].push({
      name: li.label || cat.category || 'Budget item',
      group: cat.group || null,
      kind: 'budget',
      amount: Number(li.amount) || 0,
    })
  }

  return monthRange.map(({ year, month, label }) => {
    const sources = []

    // Commitment demand for this month.
    for (const c of commitments) {
      const demand = commitmentMonthlyDemand(c, year, month)
      if (demand > 0) {
        sources.push({
          name: c.name || 'Commitment',
          group: describeCostStructure(c.cost_structure),
          kind: 'commitment',
          amount: demand,
        })
      }
    }

    // Non-Monthly budget demand for this month.
    const budgetRows = budgetByMonth[`${year}-${month}`] || []
    for (const b of budgetRows) {
      if (b.amount > 0) sources.push(b)
    }

    sources.sort((a, b) => b.amount - a.amount) // largest first
    const totalOut = sources.reduce((s, r) => s + r.amount, 0)

    return { year, month, label, totalOut, sources }
  })
}

// Group 12 months into 4 quarters. For trailing view Q1=oldest; for forward
// view Q1=soonest. Net is only meaningful when income is present (Actuals).
function buildQuarters(monthData) {
  const quarters = []
  for (let q = 0; q < 4; q++) {
    const slice = monthData.slice(q * 3, q * 3 + 3)
    const totalOut = slice.reduce((s, m) => s + m.totalOut, 0)
    const totalIn = slice.reduce((s, m) => s + (m.totalIn || 0), 0)
    const net = totalIn - totalOut
    const label = `Q${q + 1}`
    const range = slice.length > 0
      ? `${slice[0].label.split(' ')[0]} – ${slice[slice.length - 1].label}`
      : ''
    quarters.push({ label, range, totalOut, totalIn, net })
  }
  return quarters
}

export default function CashFlow({ userId, mobile }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [commitments, setCommitments] = useState([])
  const [lineItems, setLineItems] = useState([])
  const [view, setView] = useState('actuals') // 'actuals' | 'planned'
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [spikeThreshold, setSpikeThreshold] = useState(5000)
  const [thresholdInput, setThresholdInput] = useState('5000')

  const trailingRange = buildTrailingRange()
  const forwardRange = buildForwardRange()

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const oldest = trailingRange[0]
      const newest = trailingRange[trailingRange.length - 1]
      const fromDate = `${oldest.year}-${String(oldest.month).padStart(2, '0')}-01`
      const lastDay = new Date(newest.year, newest.month, 0).getDate()
      const toDate = `${newest.year}-${String(newest.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      const [txns, comms, items] = await Promise.all([
        getTransactionsByMonth(userId, fromDate, toDate),
        getCommitments(userId, { status: 'active' }),
        getBudgetLineItems(userId),
      ])
      setTransactions(txns)
      setCommitments(comms)
      setLineItems(items)
    } catch (e) {
      setError(e.message || 'Failed to load cash flow data.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  function handleThresholdBlur() {
    const parsed = parseFloat(thresholdInput.replace(/[^0-9.]/g, ''))
    if (!isNaN(parsed) && parsed > 0) {
      setSpikeThreshold(parsed)
    } else {
      setThresholdInput(String(spikeThreshold))
    }
  }

  function handleMonthClick(m) {
    setSelectedMonth(prev =>
      prev && prev.year === m.year && prev.month === m.month ? null : m
    )
  }

  function switchView(next) {
    setView(next)
    setSelectedMonth(null)
  }

  const planned = view === 'planned'
  const monthData = planned
    ? aggregatePlannedByMonth(commitments, lineItems, forwardRange)
    : aggregateByMonth(transactions, trailingRange)
  const quarters = buildQuarters(monthData)
  const hasPlannedData = commitments.length > 0 || lineItems.length > 0

  const cols = mobile ? 2 : 4

  // Loading state
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '320px' }}>
        <div style={{
          width: '28px',
          height: '28px',
          border: '2px solid var(--bd)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--warn)',
        borderRadius: '12px',
        padding: '28px 24px',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '11px',
          color: 'var(--warn)',
          letterSpacing: '0.08em',
          marginBottom: '10px',
        }}>
          // error
        </div>
        <div style={{ fontSize: '14px', color: 'var(--tx-2)', marginBottom: '18px' }}>{error}</div>
        <button
          onClick={load}
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-tx-on)',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 20px',
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  // Empty state — only when the active view has nothing to show.
  const viewEmpty = planned ? !hasPlannedData : transactions.length === 0
  if (viewEmpty) {
    return (
      <div>
        <PageHeader
          view={view}
          switchView={switchView}
          thresholdInput={thresholdInput}
          setThresholdInput={setThresholdInput}
          handleThresholdBlur={handleThresholdBlur}
          mobile={mobile}
        />
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--bd)',
          borderRadius: '12px',
          padding: '40px 28px',
          textAlign: 'center',
          marginTop: '24px',
        }}>
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '18px',
            color: 'var(--tx-1)',
            marginBottom: '10px',
          }}>
            {planned ? 'No planned cash demands yet' : 'No transaction data found'}
          </div>
          <div style={{ fontSize: '13.5px', color: 'var(--tx-2)', lineHeight: '1.6' }}>
            {planned
              ? 'Add long-term commitments or generate a budget to see upcoming cash demands.'
              : 'Import a CSV to populate the cash flow calendar.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        view={view}
        switchView={switchView}
        spikeThreshold={spikeThreshold}
        thresholdInput={thresholdInput}
        setThresholdInput={setThresholdInput}
        handleThresholdBlur={handleThresholdBlur}
        mobile={mobile}
      />

      {/* Month grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: '12px',
        marginBottom: '28px',
      }}>
        {monthData.map(m => {
          const isSpike = m.totalOut > spikeThreshold
          const isSelected = selectedMonth && selectedMonth.year === m.year && selectedMonth.month === m.month

          return (
            <button
              key={`${m.year}-${m.month}`}
              onClick={() => handleMonthClick(m)}
              style={{
                background: isSelected ? 'var(--accent-bg)' : 'var(--bg-card)',
                border: isSelected
                  ? '1px solid var(--accent-bd)'
                  : isSpike
                    ? '1px solid var(--warn)'
                    : '1px solid var(--bd)',
                borderRadius: '10px',
                padding: mobile ? '14px 12px' : '16px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              {/* Month label row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '10px',
              }}>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '10px',
                  color: 'var(--tx-3)',
                  letterSpacing: '0.08em',
                }}>
                  {m.label}
                </span>
                {isSpike && (
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '9px',
                    letterSpacing: '0.06em',
                    color: 'var(--warn)',
                    background: 'var(--warn-bg)',
                    borderRadius: '4px',
                    padding: '2px 5px',
                  }}>
                    SPIKE
                  </span>
                )}
              </div>

              {/* Total out */}
              <div style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: mobile ? '20px' : '24px',
                color: isSpike ? 'var(--warn)' : 'var(--tx-1)',
                lineHeight: 1.1,
                marginBottom: '2px',
              }}>
                {fmtMoney(m.totalOut)}
              </div>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '9px',
                color: 'var(--tx-3)',
                letterSpacing: '0.08em',
                marginBottom: '8px',
              }}>
                {planned ? 'planned out' : 'out'}
              </div>

              {planned ? (
                /* Planned: source count */
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '10px',
                  color: 'var(--tx-3)',
                  letterSpacing: '0.04em',
                }}>
                  {m.sources.length} {m.sources.length === 1 ? 'source' : 'sources'}
                </div>
              ) : (
                <>
                  {/* Net line */}
                  <div style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '10px',
                    color: m.net >= 0 ? 'var(--accent)' : 'var(--warn)',
                    letterSpacing: '0.04em',
                  }}>
                    net {m.net >= 0 ? '+' : ''}{fmtMoneyFull(m.net)}
                  </div>
                  {/* In line */}
                  <div style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '10px',
                    color: 'var(--tx-3)',
                    letterSpacing: '0.04em',
                    marginTop: '2px',
                  }}>
                    in {fmtMoney(m.totalIn)}
                  </div>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* Detail panel */}
      {selectedMonth && (() => {
        const m = monthData.find(x => x.year === selectedMonth.year && x.month === selectedMonth.month)
        if (!m) return null
        return (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--accent-bd)',
            borderRadius: '12px',
            padding: '22px 20px',
            marginBottom: '28px',
          }}>
            <div style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '10px',
              color: 'var(--accent)',
              letterSpacing: '0.1em',
              marginBottom: '14px',
            }}>
              // {m.label.toLowerCase()} {planned ? 'planned demand' : 'breakdown'}
            </div>

            {planned ? (
              m.sources.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--tx-3)' }}>No planned demand this month.</div>
              ) : (
                <PlannedTable sources={m.sources} />
              )
            ) : (
              m.byCategory.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--tx-3)' }}>No transactions this month.</div>
              ) : (
                <ActualsTable byCategory={m.byCategory} />
              )
            )}
          </div>
        )
      })()}

      {/* Quarter summary */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bd)',
        borderRadius: '12px',
        padding: '22px 20px',
      }}>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '10px',
          color: 'var(--accent)',
          letterSpacing: '0.1em',
          marginBottom: '16px',
        }}>
          // {planned ? 'next 4 quarters' : 'trailing 4 quarters'}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: '12px',
        }}>
          {quarters.map(q => (
            <div key={q.label} style={{
              background: 'var(--bg-app)',
              borderRadius: '8px',
              padding: '14px 12px',
              border: '1px solid var(--bd-light)',
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '10px',
                color: 'var(--accent)',
                letterSpacing: '0.08em',
                marginBottom: '4px',
              }}>
                {q.label}
              </div>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '9px',
                color: 'var(--tx-3)',
                marginBottom: '10px',
              }}>
                {q.range}
              </div>
              <div style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: '18px',
                color: 'var(--tx-1)',
                marginBottom: '2px',
              }}>
                {fmtMoney(q.totalOut)}
              </div>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '9px',
                color: 'var(--tx-3)',
                letterSpacing: '0.06em',
                marginBottom: planned ? 0 : '6px',
              }}>
                {planned ? 'planned out' : 'out'}
              </div>
              {!planned && (
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '10px',
                  color: q.net >= 0 ? 'var(--accent)' : 'var(--warn)',
                }}>
                  net {q.net >= 0 ? '+' : ''}{fmtMoneyFull(q.net)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ActualsTable({ byCategory }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '13px',
        fontFamily: 'Inter, sans-serif',
      }}>
        <thead>
          <tr>
            {['Category', 'Group', 'Amount'].map(h => (
              <th key={h} style={{
                textAlign: h === 'Amount' ? 'right' : 'left',
                fontFamily: "'DM Mono', monospace",
                fontSize: '9px',
                letterSpacing: '0.1em',
                color: 'var(--tx-3)',
                paddingBottom: '8px',
                borderBottom: '1px solid var(--bd-light)',
                fontWeight: 500,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {byCategory.map((c, i) => (
            <tr key={c.category} style={{ borderBottom: i < byCategory.length - 1 ? '1px solid var(--bd-light)' : 'none' }}>
              <td style={{ padding: '7px 0', color: 'var(--tx-1)' }}>{c.category}</td>
              <td style={{
                padding: '7px 12px 7px 0',
                color: 'var(--tx-3)',
                fontFamily: "'DM Mono', monospace",
                fontSize: '11px',
              }}>
                {c.group || '—'}
              </td>
              <td style={{
                textAlign: 'right',
                fontFamily: "'DM Mono', monospace",
                fontSize: '12px',
                color: c.total < 0 ? 'var(--warn)' : 'var(--accent)',
              }}>
                {fmtMoneyFull(c.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlannedTable({ sources }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '13px',
        fontFamily: 'Inter, sans-serif',
      }}>
        <thead>
          <tr>
            {['Source', 'Type', 'Amount'].map(h => (
              <th key={h} style={{
                textAlign: h === 'Amount' ? 'right' : 'left',
                fontFamily: "'DM Mono', monospace",
                fontSize: '9px',
                letterSpacing: '0.1em',
                color: 'var(--tx-3)',
                paddingBottom: '8px',
                borderBottom: '1px solid var(--bd-light)',
                fontWeight: 500,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((s, i) => (
            <tr key={`${s.kind}-${s.name}-${i}`} style={{ borderBottom: i < sources.length - 1 ? '1px solid var(--bd-light)' : 'none' }}>
              <td style={{ padding: '7px 0', color: 'var(--tx-1)' }}>
                <span style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  marginRight: '8px',
                  background: s.kind === 'commitment' ? 'var(--accent)' : 'var(--warn)',
                  verticalAlign: 'middle',
                }} />
                {s.name}
              </td>
              <td style={{
                padding: '7px 12px 7px 0',
                color: 'var(--tx-3)',
                fontFamily: "'DM Mono', monospace",
                fontSize: '11px',
              }}>
                {s.kind === 'commitment' ? (s.group || 'Commitment') : 'Non-Monthly'}
              </td>
              <td style={{
                textAlign: 'right',
                fontFamily: "'DM Mono', monospace",
                fontSize: '12px',
                color: 'var(--warn)',
              }}>
                {fmtMoneyFull(s.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PageHeader({ view, switchView, thresholdInput, setThresholdInput, handleThresholdBlur, mobile }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{
        display: 'flex',
        alignItems: mobile ? 'flex-start' : 'center',
        flexDirection: mobile ? 'column' : 'row',
        justifyContent: 'space-between',
        gap: '14px',
      }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
            color: 'var(--accent)',
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-bd)',
            marginBottom: '12px',
          }}>
            ◷
          </div>
          <h1 style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '22px',
            fontWeight: 400,
            color: 'var(--tx-1)',
            margin: 0,
            lineHeight: 1.1,
          }}>
            {view === 'planned' ? 'Next 12 Months — Planned' : '12-Month Rolling Calendar'}
          </h1>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}>
          <label style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '10px',
            color: 'var(--tx-3)',
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
          }}>
            Spike threshold
          </label>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--bg-card)',
            border: '1px solid var(--bd)',
            borderRadius: '7px',
            padding: '5px 10px',
            gap: '4px',
          }}>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '12px',
              color: 'var(--tx-3)',
            }}>$</span>
            <input
              type="text"
              value={thresholdInput}
              onChange={e => setThresholdInput(e.target.value)}
              onBlur={handleThresholdBlur}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                fontFamily: "'DM Mono', monospace",
                fontSize: '12px',
                color: 'var(--tx-1)',
                width: '64px',
              }}
            />
          </div>
        </div>
      </div>

      {/* View toggle: Actuals (trailing) vs Planned (forward) */}
      <div style={{
        display: 'inline-flex',
        marginTop: '18px',
        background: 'var(--bg-card)',
        border: '1px solid var(--bd)',
        borderRadius: '8px',
        padding: '3px',
        gap: '3px',
      }}>
        {[
          { id: 'actuals', label: 'Actuals' },
          { id: 'planned', label: 'Planned' },
        ].map(opt => {
          const active = view === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => switchView(opt.id)}
              style={{
                background: active ? 'var(--accent-bg)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--tx-3)',
                border: active ? '1px solid var(--accent-bd)' : '1px solid transparent',
                borderRadius: '6px',
                padding: '5px 16px',
                fontFamily: "'DM Mono', monospace",
                fontSize: '11px',
                letterSpacing: '0.06em',
                cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
