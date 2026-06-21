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

  const thStyle = {
    padding: mobile ? '0 8px 10px' : '0 16px 10px',
    textAlign: 'right',
    fontFamily: "'DM Mono', monospace", fontSize: 9,
    letterSpacing: '0.06em', color: 'var(--tx-2)',
    textTransform: 'uppercase', fontWeight: 400,
    whiteSpace: 'nowrap',
    minWidth: CELL_W,
  }

  return (
    <div>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.07em',
        color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 18,
      }}>
        CC statement payments due each month — actuals where entered, engine forecast otherwise
      </div>

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{
                position: 'sticky', left: 0, zIndex: 2,
                background: 'var(--bg-app)',
                padding: mobile ? '0 8px 10px 0' : '0 16px 10px 0',
                textAlign: 'left',
                fontFamily: "'DM Mono', monospace", fontSize: 9,
                letterSpacing: '0.08em', color: 'var(--tx-3)',
                textTransform: 'uppercase', fontWeight: 400,
                minWidth: 52,
              }}>Month</th>

              {activeCards.map(card => (
                <th key={card.id} style={thStyle}>
                  <div style={{ color: 'var(--tx-1)' }}>{card.name}</div>
                  {card.statement_close_day && (
                    <div style={{ color: 'var(--tx-4)', fontSize: 8, marginTop: 2, fontWeight: 400 }}>
                      closes {ordDay(card.statement_close_day)}
                    </div>
                  )}
                </th>
              ))}

              <th style={{
                ...thStyle,
                borderLeft: '1px solid var(--bd)',
                color: 'var(--tx-3)',
                paddingLeft: mobile ? 8 : 16,
              }}>Total</th>
            </tr>
          </thead>

          <tbody>
            {rows.map(({ label, month, isPast, isCurrent, cells, rowTotal }) => (
              <tr key={month} style={{
                borderTop: '1px solid var(--bd-light)',
                background: isCurrent ? 'var(--accent-bg)' : 'transparent',
              }}>
                {/* Sticky month label */}
                <td style={{
                  position: 'sticky', left: 0, zIndex: 1,
                  background: isCurrent ? 'var(--accent-bg)' : 'var(--bg-app)',
                  padding: mobile ? '9px 8px 9px 0' : '10px 16px 10px 0',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: mobile ? 10 : 11,
                  color: isCurrent ? 'var(--accent)' : isPast ? 'var(--tx-2)' : 'var(--tx-3)',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
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
                    padding: mobile ? '9px 8px' : '10px 16px',
                    textAlign: 'right',
                    verticalAlign: 'top',
                    minWidth: CELL_W,
                  }}>
                    {amount != null && amount > 0 ? (
                      <>
                        <div style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: mobile ? 11 : 12,
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
                          {isActual ? (
                            <span style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 7.5,
                              background: 'var(--accent-bg)', color: 'var(--accent)',
                              border: '1px solid var(--accent-bd)',
                              borderRadius: 3, padding: '1px 4px',
                              letterSpacing: '0.05em', textTransform: 'uppercase',
                            }}>ACT</span>
                          ) : (
                            <span style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 7.5,
                              color: 'var(--tx-4)', border: '1px solid var(--bd)',
                              borderRadius: 3, padding: '1px 4px',
                              letterSpacing: '0.05em', textTransform: 'uppercase',
                            }}>FCST</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: 'var(--tx-4)', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>—</span>
                    )}
                  </td>
                ))}

                {/* Row total */}
                <td style={{
                  padding: mobile ? '9px 0 9px 8px' : '10px 0 10px 16px',
                  textAlign: 'right',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: mobile ? 11 : 12,
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
            <tr style={{ borderTop: '2px solid var(--bd)' }}>
              <td style={{
                position: 'sticky', left: 0, zIndex: 1,
                background: 'var(--bg-app)',
                padding: mobile ? '10px 8px 10px 0' : '12px 16px 12px 0',
                fontFamily: "'DM Mono', monospace", fontSize: 9,
                letterSpacing: '0.08em', color: 'var(--tx-3)',
                textTransform: 'uppercase',
              }}>Full Year</td>

              {annualTotals.map((total, ci) => (
                <td key={activeCards[ci].id} style={{
                  padding: mobile ? '10px 8px' : '12px 16px',
                  textAlign: 'right',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: mobile ? 11 : 12,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--tx-2)',
                  fontWeight: 600,
                }}>
                  {total > 0 ? fmt(total) : '—'}
                </td>
              ))}

              <td style={{
                padding: mobile ? '10px 0 10px 8px' : '12px 0 12px 16px',
                textAlign: 'right',
                fontFamily: "'DM Mono', monospace",
                fontSize: mobile ? 12 : 13,
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
  )
}
