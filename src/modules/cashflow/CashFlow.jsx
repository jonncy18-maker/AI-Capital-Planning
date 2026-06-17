import { useState, useEffect, useCallback } from 'react'
import { getTransactionsByMonth } from '../../lib/db/transactions.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMoney(n) {
  if (Math.abs(n) >= 1000) return '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
  return '$' + Math.round(Math.abs(n)).toLocaleString()
}

function fmtMoneyFull(n) {
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString()
}

// Build array of 12 months: [{year, month, label}, ...] oldest first
function buildMonthRange() {
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

// Aggregate raw transactions into monthly buckets
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

// Group 12 months into 4 trailing quarters (Q1=oldest, Q4=most recent)
function buildQuarters(monthData) {
  const quarters = []
  for (let q = 0; q < 4; q++) {
    const slice = monthData.slice(q * 3, q * 3 + 3)
    const totalOut = slice.reduce((s, m) => s + m.totalOut, 0)
    const totalIn = slice.reduce((s, m) => s + m.totalIn, 0)
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
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [spikeThreshold, setSpikeThreshold] = useState(5000)
  const [thresholdInput, setThresholdInput] = useState('5000')

  const monthRange = buildMonthRange()

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const oldest = monthRange[0]
      const newest = monthRange[monthRange.length - 1]
      const fromDate = `${oldest.year}-${String(oldest.month).padStart(2, '0')}-01`
      const lastDay = new Date(newest.year, newest.month, 0).getDate()
      const toDate = `${newest.year}-${String(newest.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      const data = await getTransactionsByMonth(userId, fromDate, toDate)
      setTransactions(data)
    } catch (e) {
      setError(e.message || 'Failed to load transactions.')
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

  const monthData = aggregateByMonth(transactions, monthRange)
  const quarters = buildQuarters(monthData)

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

  // Empty state
  if (transactions.length === 0) {
    return (
      <div>
        <PageHeader spikeThreshold={spikeThreshold} thresholdInput={thresholdInput} setThresholdInput={setThresholdInput} handleThresholdBlur={handleThresholdBlur} mobile={mobile} />
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
            No transaction data found
          </div>
          <div style={{ fontSize: '13.5px', color: 'var(--tx-2)', lineHeight: '1.6' }}>
            Import a CSV to populate the cash flow calendar.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
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
                out
              </div>

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
            </button>
          )
        })}
      </div>

      {/* Category detail panel */}
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
              // {m.label.toLowerCase()} breakdown
            </div>

            {m.byCategory.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--tx-3)' }}>No transactions this month.</div>
            ) : (
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
                    {m.byCategory.map((c, i) => (
                      <tr key={c.category} style={{ borderBottom: i < m.byCategory.length - 1 ? '1px solid var(--bd-light)' : 'none' }}>
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
          // trailing 4 quarters
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
                marginBottom: '6px',
              }}>
                out
              </div>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '10px',
                color: q.net >= 0 ? 'var(--accent)' : 'var(--warn)',
              }}>
                net {q.net >= 0 ? '+' : ''}{fmtMoneyFull(q.net)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PageHeader({ spikeThreshold, thresholdInput, setThresholdInput, handleThresholdBlur, mobile }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: mobile ? 'flex-start' : 'center',
      flexDirection: mobile ? 'column' : 'row',
      justifyContent: 'space-between',
      gap: '14px',
      marginBottom: '28px',
    }}>
      <div>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '10px',
          color: 'var(--accent)',
          letterSpacing: '0.1em',
          marginBottom: '6px',
        }}>
          // cash flow timing
        </div>
        <h1 style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: mobile ? '24px' : '30px',
          fontWeight: 400,
          color: 'var(--tx-1)',
          margin: 0,
          lineHeight: 1.1,
        }}>
          12-Month Rolling Calendar
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
  )
}
