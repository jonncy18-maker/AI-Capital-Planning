import { useState, useEffect } from 'react'
import { getBillAmountsRange } from '../../lib/db/bills.js'
import { statementDueIn } from '../../lib/cashflow/cashflowEngine.js'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(n) {
  if (n == null || n === 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}

function ordDay(d) {
  const s = ['th','st','nd','rd']
  const v = d % 100
  return d + (s[(v - 20) % 10] || s[v] || s[0])
}

const CELL_W = 130

export default function CCScheduleTab({ userId, bills, creditCards, statementsByCard, navYear, mobile }) {
  const [amountIndex, setAmountIndex] = useState({})
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // card id → linked bill
  const cardToBill = {}
  for (const b of bills) {
    if (b.credit_card_id) cardToBill[b.credit_card_id] = b
  }

  // Only show cards that have a projected statement or a linked bill
  const activeCards = (creditCards ?? []).filter(c =>
    cardToBill[c.id] || (statementsByCard[c.id] ?? []).some(s => s.balance > 0.5)
  )

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    getBillAmountsRange(userId, navYear, navYear)
      .then(rows => {
        if (cancelled) return
        const idx = {}
        for (const r of rows) {
          if (!idx[r.bill_id]) idx[r.bill_id] = {}
          idx[r.bill_id][r.month] = r.amount
        }
        setAmountIndex(idx)
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, navYear])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2px solid var(--accent)', borderTopColor: 'transparent',
          animation: 'spin 0.7s linear infinite',
        }} />
      </div>
    )
  }

  if (activeCards.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
        No credit cards with billing cycles set up. Configure cards in Credit Cards → Cards Setup.
      </div>
    )
  }

  // Build all row data upfront so we can sum the annual total row
  const rows = MONTH_NAMES.map((label, i) => {
    const month = i + 1
    const isPast = navYear < currentYear || (navYear === currentYear && month < currentMonth)
    const isCurrent = navYear === currentYear && month === currentMonth

    let rowTotal = 0
    const cells = activeCards.map(card => {
      const bill = cardToBill[card.id]
      const due = statementDueIn(statementsByCard[card.id] ?? [], navYear, month)

      let amount = null
      let isActual = false

      if (bill && amountIndex[bill.id]?.[month] != null) {
        amount = amountIndex[bill.id][month]
        isActual = true
      } else if (due?.balance > 0.5) {
        amount = due.balance
      }

      if (amount != null) rowTotal += amount
      return { card, amount, isActual, due, isPast, isCurrent }
    })

    return { label, month, isPast, isCurrent, cells, rowTotal }
  })

  const annualTotals = activeCards.map((card, ci) =>
    rows.reduce((s, r) => s + (r.cells[ci].amount ?? 0), 0)
  )
  const grandTotal = annualTotals.reduce((s, v) => s + v, 0)

  // Background for a body row (zebra striping; current month accented).
  const rowBg = (isCurrent, i) => isCurrent ? 'var(--accent-bg)' : (i % 2 ? 'var(--bg-app)' : 'var(--bg-card)')

  const thStyle = {
    padding: mobile ? '10px 8px' : '12px 16px',
    textAlign: 'right',
    fontFamily: "'DM Mono', monospace", fontSize: 9,
    letterSpacing: '0.06em', color: 'var(--tx-2)',
    textTransform: 'uppercase', fontWeight: 400,
    whiteSpace: 'nowrap',
    minWidth: CELL_W,
  }

  // Pill style shared by ACT / FCST badges.
  const badge = (active) => ({
    fontFamily: "'DM Mono', monospace", fontSize: 7.5,
    borderRadius: 4, padding: '1px 5px',
    letterSpacing: '0.05em', textTransform: 'uppercase',
    background: active ? 'var(--accent-bg)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--tx-4)',
    border: `1px solid ${active ? 'var(--accent-bd)' : 'var(--bd)'}`,
  })

  return (
    <div>
      {/* Card container */}
      <div style={{
        border: '1px solid var(--bd)', borderRadius: 12,
        background: 'var(--bg-card)', overflow: 'hidden',
      }}>
        {/* Header strip */}
        <div style={{
          padding: '13px 18px', borderBottom: '1px solid var(--bd)', background: 'var(--bg-app)',
        }}>
          <div style={{
            fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.07em',
            color: 'var(--tx-3)', textTransform: 'uppercase',
          }}>
            CC statement payments due each month — actuals where entered, engine forecast otherwise
          </div>
        </div>

        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{
                  position: 'sticky', left: 0, top: 0, zIndex: 3,
                  background: 'var(--bg-app)',
                  padding: mobile ? '12px 8px' : '12px 16px',
                  textAlign: 'left',
                  fontFamily: "'DM Mono', monospace", fontSize: 9,
                  letterSpacing: '0.08em', color: 'var(--tx-3)',
                  textTransform: 'uppercase', fontWeight: 400,
                  minWidth: 56, borderBottom: '1px solid var(--bd)',
                }}>Month</th>

                {activeCards.map(card => (
                  <th key={card.id} style={{ ...thStyle, background: 'var(--bg-app)', borderBottom: '1px solid var(--bd)' }}>
                    <div style={{ color: 'var(--tx-1)', fontWeight: 500, letterSpacing: '0.02em' }}>{card.name}</div>
                    {card.statement_close_day && (
                      <div style={{ color: 'var(--tx-4)', fontSize: 8, marginTop: 2, fontWeight: 400 }}>
                        closes {ordDay(card.statement_close_day)}
                      </div>
                    )}
                  </th>
                ))}

                <th style={{
                  ...thStyle,
                  background: 'var(--bg-app)',
                  borderBottom: '1px solid var(--bd)',
                  borderLeft: '1px solid var(--bd)',
                  color: 'var(--tx-3)',
                }}>Total</th>
              </tr>
            </thead>

            <tbody>
              {rows.map(({ label, month, isPast, isCurrent, cells, rowTotal }, i) => (
                <tr key={month} style={{ background: rowBg(isCurrent, i) }}>
                  {/* Sticky month label */}
                  <td style={{
                    position: 'sticky', left: 0, zIndex: 1,
                    background: rowBg(isCurrent, i),
                    padding: mobile ? '9px 8px' : '11px 16px',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: mobile ? 10 : 11,
                    color: isCurrent ? 'var(--accent)' : isPast ? 'var(--tx-2)' : 'var(--tx-3)',
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    borderLeft: isCurrent ? '2px solid var(--accent)' : '2px solid transparent',
                  }}>
                    {label}
                    {isCurrent && (
                      <span style={{
                        fontSize: 7.5, color: 'var(--accent)', marginLeft: 5,
                        fontFamily: "'DM Mono', monospace", letterSpacing: '0.06em',
                      }}>NOW</span>
                    )}
                  </td>

                  {cells.map(({ card, amount, isActual, due }) => (
                    <td key={card.id} style={{
                      padding: mobile ? '9px 8px' : '11px 16px',
                      textAlign: 'right',
                      verticalAlign: 'top',
                      minWidth: CELL_W,
                    }}>
                      {amount != null && amount > 0 ? (
                        <>
                          <div style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: mobile ? 11 : 12.5,
                            fontVariantNumeric: 'tabular-nums',
                            color: isActual ? 'var(--tx-1)' : 'var(--tx-2)',
                            opacity: isPast && !isActual ? 0.5 : 1,
                          }}>
                            {fmt(amount)}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 3 }}>
                            {due && (
                              <span style={{
                                fontFamily: "'DM Mono', monospace", fontSize: 8,
                                color: 'var(--tx-4)', letterSpacing: '0.03em',
                              }}>
                                due {ordDay(due.dueDate.getDate())}
                              </span>
                            )}
                            <span style={badge(isActual)}>{isActual ? 'ACT' : 'FCST'}</span>
                          </div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--tx-4)', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>—</span>
                      )}
                    </td>
                  ))}

                  {/* Row total */}
                  <td style={{
                    padding: mobile ? '9px 16px' : '11px 16px',
                    textAlign: 'right',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: mobile ? 11 : 12.5,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--tx-1)',
                    fontWeight: 600,
                    borderLeft: '1px solid var(--bd)',
                    whiteSpace: 'nowrap',
                  }}>
                    {rowTotal > 0 ? fmt(rowTotal) : '—'}
                  </td>
                </tr>
              ))}

              {/* Annual total row */}
              <tr style={{ borderTop: '2px solid var(--bd)', background: 'var(--bg-app)' }}>
                <td style={{
                  position: 'sticky', left: 0, zIndex: 1,
                  background: 'var(--bg-app)',
                  padding: mobile ? '12px 8px' : '14px 16px',
                  fontFamily: "'DM Mono', monospace", fontSize: 9,
                  letterSpacing: '0.08em', color: 'var(--tx-2)',
                  textTransform: 'uppercase', fontWeight: 500,
                }}>Full Year</td>

                {annualTotals.map((total, ci) => (
                  <td key={activeCards[ci].id} style={{
                    padding: mobile ? '12px 8px' : '14px 16px',
                    textAlign: 'right',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: mobile ? 11 : 12.5,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--tx-2)',
                    fontWeight: 600,
                  }}>
                    {total > 0 ? fmt(total) : '—'}
                  </td>
                ))}

                <td style={{
                  padding: mobile ? '12px 16px' : '14px 16px',
                  textAlign: 'right',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: mobile ? 12 : 13.5,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--accent)',
                  fontWeight: 700,
                  borderLeft: '1px solid var(--bd)',
                  whiteSpace: 'nowrap',
                }}>
                  {grandTotal > 0 ? fmt(grandTotal) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
