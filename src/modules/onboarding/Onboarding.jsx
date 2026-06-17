import { useState, useEffect, useRef } from 'react'
import { derivePeriods } from '../../lib/periods.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function useWindowWidth() {
  const [width, setWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  )
  useEffect(() => {
    const handle = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])
  return width
}

function toggle(arr, v) {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
}

// ── commitment → budget bucket mapping ───────────────────────────────────────

const COMMITMENT_BUCKET_MAP = {
  'Scholarship or education support': { id: 'scholarship', label: 'Scholarship / Education Support', type: 'Non-Monthly', group: 'Commitments' },
  'Family financial support': { id: 'family_support', label: 'Family Financial Support', type: 'Non-Monthly', group: 'Commitments' },
  'Vehicle lease or loan': { id: 'vehicle', label: 'Vehicle Lease / Loan', type: 'Fixed', group: 'Transportation' },
  'Eldercare or dependent support': { id: 'eldercare', label: 'Eldercare / Dependent Support', type: 'Non-Monthly', group: 'Commitments' },
}

function deriveBudgetBuckets(q2, q2other, q2buckets) {
  const buckets = []
  q2.forEach(sel => {
    if (sel === 'None currently' || sel === 'Other') return
    const mapped = COMMITMENT_BUCKET_MAP[sel]
    if (mapped) buckets.push(mapped)
  })
  if (q2.includes('Other') && q2other.trim()) {
    buckets.push({ id: 'other_custom', label: q2other.trim(), type: 'Non-Monthly', group: 'Commitments' })
  }
  q2buckets.forEach((b, i) => {
    if (b.trim()) buckets.push({ id: `custom_${i}`, label: b.trim(), type: 'Non-Monthly', group: 'Commitments' })
  })
  return buckets
}

// ── sub-components ────────────────────────────────────────────────────────────

function OptRow({ label, selected, onClick, round }) {
  const base = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '13px 15px',
    borderRadius: '9px',
    cursor: 'pointer',
    fontSize: '13.5px',
    color: 'var(--tx-1)',
    transition: 'border-color .15s, background .15s',
    userSelect: 'none',
  }
  const sel = {
    border: '1px solid var(--accent)',
    background: 'var(--accent-bg)',
  }
  const unsel = {
    border: '1px solid var(--bd)',
    background: 'var(--bg-card)',
  }
  const indBase = {
    width: '19px',
    height: '19px',
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 500,
    borderRadius: round ? '50%' : '5px',
  }
  const indSel = {
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: 'var(--accent-tx-on)',
  }
  const indUnsel = {
    border: '1px solid var(--tx-3)',
    color: 'transparent',
  }
  return (
    <div
      className="ob-opt"
      style={{ ...base, ...(selected ? sel : unsel) }}
      onClick={onClick}
    >
      <div style={{ ...indBase, ...(selected ? indSel : indUnsel) }}>
        {selected ? '✓' : ''}
      </div>
      <span>{label}</span>
    </div>
  )
}

// ── STEP 1 ────────────────────────────────────────────────────────────────────

function Step1({ onNext }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: '24px' }}>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '11px',
        color: 'var(--accent)',
        letterSpacing: '0.1em',
      }}>
        // welcome
      </div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '38px',
        lineHeight: '1.18',
        color: 'var(--tx-1)',
        margin: '18px 0 18px',
        letterSpacing: '-0.015em',
      }}>
        Your capital planning command center.
      </div>
      <div style={{
        fontSize: '14.5px',
        lineHeight: '1.7',
        color: 'var(--tx-2)',
        maxWidth: '420px',
        margin: '0 auto',
      }}>
        This is a decision engine, not a budgeting app. It models your financial
        future, surfaces cash-flow timing, and pressure-tests big commitments
        before you make them. Setup takes about five minutes.
      </div>
      <button
        onClick={onNext}
        style={{
          marginTop: '34px',
          background: 'var(--accent)',
          color: 'var(--accent-tx-on)',
          border: 'none',
          borderRadius: '8px',
          padding: '14px 30px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Get started →
      </button>
    </div>
  )
}

// ── STEP 2 ────────────────────────────────────────────────────────────────────

const Q1_BASE = [
  'Building long-term wealth',
  'Managing monthly cash flow',
  'Tracking long-term commitments',
  'Planning a major purchase or event',
]
const Q1_OPTS = [...Q1_BASE, 'All of the above']

const Q2_OPTS = [
  'Scholarship or education support',
  'Family financial support',
  'Vehicle lease or loan',
  'Eldercare or dependent support',
  'Other',
  'None currently',
]


function Step2({
  sub,
  q1, setQ1,
  q2, setQ2, q2other, setQ2other, q2buckets, setQ2buckets,
  q3, setQ3,
  mobile,
}) {
  const otherRef = useRef(null)

  // focus the "Other" text field when it appears
  useEffect(() => {
    if (q2.includes('Other') && otherRef.current) {
      const t = setTimeout(() => { otherRef.current && otherRef.current.focus() }, 60)
      return () => clearTimeout(t)
    }
  }, [q2.includes('Other')]) // eslint-disable-line react-hooks/exhaustive-deps

  function clickQ1(label) {
    if (label === 'All of the above') {
      const allSel = Q1_BASE.every(b => q1.includes(b))
      setQ1(allSel ? [] : [...Q1_BASE])
    } else {
      setQ1(toggle(q1, label))
    }
  }

  function clickQ2(label) {
    if (label === 'None currently') {
      setQ2(q2.includes('None currently') ? [] : ['None currently'])
      if (!q2.includes('None currently')) setQ2other('')
    } else {
      const next = toggle(q2.filter(x => x !== 'None currently'), label)
      setQ2(next)
    }
  }

  function addBucket() {
    if (q2buckets.length < 5) setQ2buckets(b => [...b, ''])
  }
  function removeBucket(i) {
    setQ2buckets(b => b.filter((_, j) => j !== i))
  }
  function updateBucket(i, v) {
    setQ2buckets(b => { const n = [...b]; n[i] = v; return n })
  }

  // pip progress bar
  const pips = [0, 1, 2].map(i => (
    <div
      key={i}
      style={{
        height: '3px',
        flex: 1,
        borderRadius: '3px',
        transition: 'background .2s',
        background: i <= sub ? 'var(--accent)' : 'var(--bd)',
      }}
    />
  ))

  // "All of the above" is selected when all base opts are selected
  const allAboveSel = Q1_BASE.every(b => q1.includes(b))
  const q1Display = allAboveSel ? [...q1, 'All of the above'] : q1
  const q1Effective = allAboveSel ? [...Q1_OPTS] : q1

  return (
    <div>
      <div style={{ display: 'flex', gap: '7px', marginBottom: '22px' }}>
        {pips}
      </div>

      {sub === 0 && (
        <div>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '10px',
            color: 'var(--accent)',
            letterSpacing: '0.1em',
          }}>
            // priorities · 1 of 3
          </div>
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '25px',
            lineHeight: '1.25',
            color: 'var(--tx-1)',
            margin: '12px 0 6px',
            letterSpacing: '-0.01em',
          }}>
            What are your primary financial focuses?
          </div>
          <div style={{
            fontSize: '12px',
            color: 'var(--tx-3)',
            marginBottom: '20px',
            fontFamily: "'DM Mono', monospace",
            letterSpacing: '0.02em',
          }}>
            SELECT ALL THAT APPLY
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {Q1_OPTS.map(label => (
              <OptRow
                key={label}
                label={label}
                selected={
                  label === 'All of the above'
                    ? allAboveSel
                    : q1.includes(label)
                }
                onClick={() => clickQ1(label)}
                round={false}
              />
            ))}
          </div>
        </div>
      )}

      {sub === 1 && (
        <div>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '10px',
            color: 'var(--accent)',
            letterSpacing: '0.1em',
          }}>
            // priorities · 2 of 3
          </div>
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '25px',
            lineHeight: '1.25',
            color: 'var(--tx-1)',
            margin: '12px 0 6px',
            letterSpacing: '-0.01em',
          }}>
            Do you have multi-year financial commitments?
          </div>
          <div style={{
            fontSize: '12px',
            color: 'var(--tx-3)',
            marginBottom: '20px',
            fontFamily: "'DM Mono', monospace",
            letterSpacing: '0.02em',
          }}>
            SELECT ALL THAT APPLY
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {Q2_OPTS.map(label => (
              <OptRow
                key={label}
                label={label}
                selected={q2.includes(label)}
                onClick={() => clickQ2(label)}
                round={false}
              />
            ))}
          </div>

          {/* "Other" expand */}
          <div style={{
            overflow: 'hidden',
            transition: 'max-height .32s cubic-bezier(.4,0,.2,1), opacity .25s',
            maxHeight: q2.includes('Other') ? '140px' : '0',
            opacity: q2.includes('Other') ? 1 : 0,
          }}>
            <div style={{ paddingTop: '12px' }}>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '9.5px',
                color: 'var(--tx-3)',
                letterSpacing: '0.06em',
                marginBottom: '7px',
              }}>
                DESCRIBE YOUR COMMITMENT
              </div>
              <input
                ref={otherRef}
                value={q2other}
                onChange={e => setQ2other(e.target.value)}
                placeholder="e.g. Charitable giving pledge, business loan, property support…"
                style={{
                  width: '100%',
                  background: 'var(--field)',
                  border: '1px solid var(--bd)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Extra buckets */}
          {q2buckets.map((val, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '9px' }}>
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                border: '1px solid var(--bd)',
                borderRadius: '9px',
                background: 'var(--field)',
                padding: '0 4px 0 14px',
              }}>
                <input
                  value={val}
                  onChange={e => updateBucket(i, e.target.value)}
                  placeholder={`Additional commitment ${i + 1}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    padding: '12px 8px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13px',
                  }}
                />
              </div>
              <button
                onClick={() => removeBucket(i)}
                title="Remove"
                style={{
                  flexShrink: 0,
                  width: '42px',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--bd)',
                  borderRadius: '9px',
                  background: 'var(--bg-card)',
                  color: 'var(--tx-3)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}

          <button
            onClick={addBucket}
            disabled={q2buckets.length >= 5}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              marginTop: '9px',
              padding: '12px',
              border: '1px dashed var(--bd)',
              borderRadius: '9px',
              background: 'none',
              fontFamily: "'DM Mono', monospace",
              fontSize: '11px',
              letterSpacing: '0.04em',
              transition: 'border-color .15s, color .15s',
              color: q2buckets.length >= 5 ? 'var(--tx-3)' : 'var(--tx-2)',
              cursor: q2buckets.length >= 5 ? 'not-allowed' : 'pointer',
            }}
          >
            {q2buckets.length >= 5 ? 'Maximum of 5 added' : '+ Add more'}
          </button>
        </div>
      )}

      {sub === 2 && (
        <div>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '10px',
            color: 'var(--accent)',
            letterSpacing: '0.1em',
          }}>
            // priorities · 3 of 3
          </div>
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '25px',
            lineHeight: '1.25',
            color: 'var(--tx-1)',
            margin: '12px 0 6px',
            letterSpacing: '-0.01em',
          }}>
            Which time horizons do you want to plan across?
          </div>
          <div style={{
            fontSize: '12px',
            color: 'var(--tx-3)',
            marginBottom: '20px',
            fontFamily: "'DM Mono', monospace",
            letterSpacing: '0.02em',
          }}>
            SELECT ANY THAT APPLY — EACH BECOMES A DASHBOARD PERIOD FILTER
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: mobile ? 'repeat(5, 1fr)' : 'repeat(10, 1fr)',
            gap: '8px',
          }}>
            {[1,2,3,4,5,6,7,8,9,10].map(yr => {
              const sel = q3.includes(yr)
              return (
                <div
                  key={yr}
                  onClick={() => setQ3(toggle(q3, yr))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '44px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '13px',
                    fontWeight: sel ? 500 : 400,
                    transition: 'all .15s',
                    border: sel ? '1px solid var(--accent)' : '1px solid var(--bd)',
                    background: sel ? 'var(--accent-bg)' : 'var(--bg-card)',
                    color: sel ? 'var(--accent)' : 'var(--tx-2)',
                  }}
                >
                  {yr}
                </div>
              )
            })}
          </div>
          {q3.length > 0 && (() => {
            const { periodOptions, periodDefault } = derivePeriods(q3)
            return (
              <div style={{
                marginTop: '16px',
                fontFamily: "'DM Mono', monospace",
                fontSize: '10px',
                color: 'var(--tx-3)',
                letterSpacing: '0.04em',
              }}>
                {`DASHBOARD WILL SHOW ${periodOptions.join(' · ')} PERIOD OPTIONS · DEFAULTS TO ${periodDefault}`}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ── STEP 3 ────────────────────────────────────────────────────────────────────

const PATH_CARDS = [
  {
    key: 'import',
    title: 'Import transaction history',
    badge: 'RECOMMENDED',
    badgeKind: 'accent',
    desc: '12–24 months of CSV from Monarch Money or any tool. The engine learns your real patterns and builds the sharpest forecasts.',
  },
  {
    key: 'partial',
    title: 'Import + set manual baseline',
    badge: 'PARTIAL DATA',
    badgeKind: 'ghost',
    desc: 'Upload what history you have, then enter group-level targets to fill the gaps. A balanced middle path.',
  },
  {
    key: 'manual',
    title: 'Start with manual baseline only',
    badge: '',
    badgeKind: '',
    desc: 'No CSV needed. Enter monthly targets by group and the app runs in forward-looking mode from day one.',
  },
]

function Step3({ path, setPath }) {
  return (
    <div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '10px',
        color: 'var(--accent)',
        letterSpacing: '0.1em',
      }}>
        // data path
      </div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '26px',
        lineHeight: '1.25',
        color: 'var(--tx-1)',
        margin: '12px 0 6px',
        letterSpacing: '-0.01em',
      }}>
        How do you want to start?
      </div>
      <div style={{
        fontSize: '13px',
        color: 'var(--tx-2)',
        marginBottom: '22px',
        lineHeight: '1.6',
      }}>
        The more history you give the engine, the sharper its forecasts. You can always add more later.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {PATH_CARDS.map(c => {
          const on = path === c.key
          const badgeStyle = c.badgeKind === 'accent'
            ? {
                fontFamily: "'DM Mono', monospace",
                fontSize: '8px',
                letterSpacing: '0.08em',
                padding: '3px 7px',
                borderRadius: '4px',
                background: 'var(--accent-bg)',
                border: '0.5px solid var(--accent-bd)',
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
              }
            : {
                fontFamily: "'DM Mono', monospace",
                fontSize: '8px',
                letterSpacing: '0.08em',
                padding: '3px 7px',
                borderRadius: '4px',
                background: 'transparent',
                border: '0.5px solid var(--bd)',
                color: 'var(--tx-3)',
                whiteSpace: 'nowrap',
              }
          return (
            <div
              key={c.key}
              onClick={() => setPath(c.key)}
              style={{
                cursor: 'pointer',
                borderRadius: '11px',
                padding: '17px 18px',
                transition: 'border-color .15s, background .15s',
                border: on ? '1px solid var(--accent)' : '1px solid var(--bd)',
                background: on ? 'var(--accent-bg)' : 'var(--bg-card)',
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                marginBottom: '8px',
              }}>
                <div style={{ fontSize: '14.5px', fontWeight: 500, color: 'var(--tx-1)' }}>
                  {c.title}
                </div>
                {c.badge && <span style={badgeStyle}>{c.badge}</span>}
              </div>
              <div style={{ fontSize: '12.5px', lineHeight: '1.6', color: 'var(--tx-2)' }}>
                {c.desc}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── STEP 4 ────────────────────────────────────────────────────────────────────

const BASELINE_CATS = [
  ['housing', 'HOUSING'],
  ['food', 'FOOD & DINING'],
  ['transport', 'TRANSPORTATION'],
  ['travel', 'TRAVEL'],
  ['health', 'HEALTH'],
  ['ent', 'ENTERTAINMENT'],
  ['subs', 'SUBSCRIPTIONS'],
  ['commit', 'COMMITMENTS'],
]

function Step4({ path, baseline, setBaseline, mobile, csvFile, setCsvFile }) {
  const showDrop = path === 'import' || path === 'partial'
  const showBaseline = path === 'manual' || path === 'partial'
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const raw = e.target.result
      const lines = raw.split('\n')
      const headers = lines[0] ? lines[0].split(',').map(h => h.trim()) : []
      const rowCount = lines.filter(l => l.trim()).length - 1
      setCsvFile({ name: file.name, headers, rowCount, raw })
    }
    reader.readAsText(file)
  }

  const step4 = path === 'manual'
    ? {
        eyebrow: '// baseline',
        title: 'Set your monthly baseline',
        sub: 'Enter a rough monthly target for each group. This seeds the forward-looking engine — you can refine everything later.',
      }
    : path === 'partial'
      ? {
          eyebrow: '// import + baseline',
          title: 'Upload history, then fill the gaps',
          sub: 'Drop any CSV you have, then set group-level targets for anything not covered.',
        }
      : {
          eyebrow: '// import',
          title: 'Import your transaction history',
          sub: 'Drop a CSV export and the engine will categorize and learn your spending patterns automatically.',
        }

  return (
    <div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '10px',
        color: 'var(--accent)',
        letterSpacing: '0.1em',
      }}>
        {step4.eyebrow}
      </div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '26px',
        lineHeight: '1.25',
        color: 'var(--tx-1)',
        margin: '12px 0 6px',
        letterSpacing: '-0.01em',
      }}>
        {step4.title}
      </div>
      <div style={{
        fontSize: '13px',
        color: 'var(--tx-2)',
        marginBottom: '22px',
        lineHeight: '1.6',
      }}>
        {step4.sub}
      </div>

      {showDrop && (
        <>
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])}
          />
          <div
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              handleFile(e.dataTransfer.files[0])
            }}
            style={{
              border: dragOver ? '1.5px dashed var(--accent)' : '1.5px dashed var(--bd)',
              borderRadius: '12px',
              padding: '38px 20px',
              textAlign: 'center',
              background: 'var(--bg-card)',
              cursor: 'pointer',
              transition: 'border-color .15s',
            }}
          >
            {csvFile ? (
              <>
                <div style={{ fontSize: '30px', color: 'var(--accent)', lineHeight: 1 }}>✓</div>
                <div style={{
                  fontSize: '14px',
                  color: 'var(--tx-1)',
                  marginTop: '14px',
                  fontWeight: 500,
                }}>
                  {csvFile.name}
                </div>
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '10px',
                  color: 'var(--tx-3)',
                  marginTop: '6px',
                  letterSpacing: '0.04em',
                }}>
                  {csvFile.rowCount} ROWS · {csvFile.headers.length} COLUMNS
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setCsvFile(null) }}
                  style={{
                    marginTop: '12px',
                    background: 'none',
                    border: '1px solid var(--bd)',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '10px',
                    color: 'var(--tx-3)',
                    cursor: 'pointer',
                    letterSpacing: '0.04em',
                  }}
                >
                  × Remove
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '30px', color: 'var(--accent)', lineHeight: 1 }}>↑</div>
                <div style={{
                  fontSize: '14px',
                  color: 'var(--tx-1)',
                  marginTop: '14px',
                  fontWeight: 500,
                }}>
                  Drop your CSV here or click to browse
                </div>
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '10px',
                  color: 'var(--tx-3)',
                  marginTop: '8px',
                  letterSpacing: '0.04em',
                }}>
                  MONARCH MONEY · YNAB · ANY STANDARD CSV EXPORT
                </div>
              </>
            )}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            marginTop: '14px',
            fontSize: '11.5px',
            color: 'var(--tx-3)',
            lineHeight: '1.6',
          }}>
            <span style={{ color: 'var(--accent)' }}>⛉</span>
            <span>Your data is processed locally and never leaves your device during import. 12–24 months recommended for accurate forecasting.</span>
          </div>
        </>
      )}

      {showBaseline && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
            gap: '14px',
            marginTop: showDrop && showBaseline ? '22px' : '0',
          }}>
            {BASELINE_CATS.map(([k, label]) => (
              <div key={k}>
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '9.5px',
                  color: 'var(--tx-3)',
                  letterSpacing: '0.04em',
                  marginBottom: '7px',
                }}>
                  {label}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: '1px solid var(--bd)',
                  borderRadius: '8px',
                  background: 'var(--field)',
                  padding: '0 12px',
                }}>
                  <span style={{
                    color: 'var(--tx-3)',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '13px',
                  }}>$</span>
                  <input
                    value={baseline[k] || ''}
                    onChange={e => setBaseline(b => ({ ...b, [k]: e.target.value }))}
                    placeholder="0"
                    inputMode="numeric"
                    style={{
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: '11px 8px',
                      fontFamily: "'DM Mono', monospace",
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div style={{
            fontSize: '11.5px',
            color: 'var(--tx-3)',
            marginTop: '14px',
            fontFamily: "'DM Mono', monospace",
            letterSpacing: '0.02em',
          }}>
            ROUGH ESTIMATES ARE FINE — REFINE IN BUDGET BUILDER LATER
          </div>
        </>
      )}
    </div>
  )
}

// ── STEP 5 ────────────────────────────────────────────────────────────────────

const CHECKLIST = [
  { label: 'Transactions imported', icon: '✓', kind: 'ok', note: '' },
  { label: 'Categories mapped', icon: '✓', kind: 'ok', note: '' },
  { label: 'Commitments noted', icon: '✓', kind: 'ok', note: '' },
  { label: 'Baseline targets set', icon: '✓', kind: 'ok', note: '' },
  { label: 'Full budget schedule', icon: '!', kind: 'warn', note: 'RUN BUDGET BUILDER TO UNLOCK' },
]

function Step5() {
  const okStyle = {
    width: '18px',
    height: '18px',
    flexShrink: 0,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    background: 'var(--accent)',
    color: 'var(--accent-tx-on)',
  }
  const warnStyle = {
    width: '18px',
    height: '18px',
    flexShrink: 0,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    background: 'var(--warn-bg)',
    color: 'var(--warn)',
    border: '0.5px solid var(--warn)',
  }

  return (
    <div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '10px',
        color: 'var(--accent)',
        letterSpacing: '0.1em',
      }}>
        // ready
      </div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '28px',
        lineHeight: '1.22',
        color: 'var(--tx-1)',
        margin: '12px 0 22px',
        letterSpacing: '-0.01em',
      }}>
        You&apos;re set up. One step unlocks the rest.
      </div>

      {/* Budget Builder banner */}
      <div style={{
        border: '1px solid var(--accent-bd)',
        borderRadius: '12px',
        background: 'var(--accent-bg)',
        padding: '22px',
      }}>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '9.5px',
          color: 'var(--accent)',
          letterSpacing: '0.1em',
        }}>
          // RECOMMENDED NEXT STEP
        </div>
        <div style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: '20px',
          color: 'var(--tx-1)',
          margin: '10px 0 9px',
          letterSpacing: '-0.01em',
        }}>
          Run your first Budget Builder session
        </div>
        <div style={{ fontSize: '12.5px', lineHeight: '1.65', color: 'var(--tx-2)' }}>
          The app works now with your baseline targets — but a full month-by-month budget unlocks
          AI briefings, accurate forecasting, and cash flow timing. The Budget Builder takes about
          10 minutes and does the heavy lifting for you.
        </div>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '11px',
          color: 'var(--accent)',
          marginTop: '14px',
          letterSpacing: '0.02em',
        }}>
          Go to Budget Builder after launch →
        </div>
      </div>

      {/* Checklist */}
      <div style={{ marginTop: '22px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {CHECKLIST.map((c, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '11px',
              padding: '11px 2px',
              borderBottom: '0.5px solid var(--bd-light)',
            }}
          >
            <span style={c.kind === 'ok' ? okStyle : warnStyle}>{c.icon}</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: '13px', color: 'var(--tx-1)' }}>
              {c.label}
            </div>
            {c.note && (
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '9.5px',
                color: 'var(--warn)',
                letterSpacing: '0.02em',
              }}>
                {c.note}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Feature availability note */}
      <div style={{
        marginTop: '20px',
        border: '0.5px solid var(--bd)',
        borderRadius: '9px',
        padding: '14px 16px',
        background: 'var(--bg-card)',
      }}>
        <div style={{ fontSize: '12px', lineHeight: '1.7', color: 'var(--tx-2)' }}>
          <span style={{
            fontFamily: "'DM Mono', monospace",
            color: 'var(--accent)',
            fontSize: '11px',
          }}>
            SCENARIOS · CASH FLOW · COMMITMENTS
          </span>{' '}
          are available now in baseline mode. Full{' '}
          <span style={{
            fontFamily: "'DM Mono', monospace",
            color: 'var(--tx-1)',
            fontSize: '11px',
          }}>
            AI BRIEFING
          </span>{' '}
          and{' '}
          <span style={{
            fontFamily: "'DM Mono', monospace",
            color: 'var(--tx-1)',
            fontSize: '11px',
          }}>
            FORECASTING
          </span>{' '}
          unlock after Budget Builder.
        </div>
      </div>
    </div>
  )
}

// ── AI BAR PLACEHOLDER ────────────────────────────────────────────────────────

function getAiPlaceholder(step, sub, path) {
  if (step === 1) return 'New here? Ask how this works…'
  if (step === 2) {
    if (sub === 0) return 'Not sure which focuses fit you? Ask…'
    if (sub === 1) return 'What counts as a multi-year commitment?'
    return 'How should I think about my planning horizon?'
  }
  if (step === 3) return 'Import or manual baseline — which is right for me?'
  if (step === 4) {
    if (path === 'manual') return 'How precise do my baseline numbers need to be?'
    if (path === 'partial') return 'Can I mix imported data with manual targets?'
    return 'What CSV format should I export?'
  }
  return 'What does Budget Builder actually do?'
}

// ── STEP LABELS ───────────────────────────────────────────────────────────────

const STEP_LABELS = ['WELCOME', 'PRIORITIES', 'DATA PATH', 'IMPORT', 'READY']

// ── MAIN ONBOARDING COMPONENT ─────────────────────────────────────────────────

export default function Onboarding({ onComplete }) {
  const [theme, setTheme] = useState('dark')
  const [step, setStep] = useState(1)
  const [sub, setSub] = useState(0)

  // step 2 state
  const [q1, setQ1] = useState([])
  const [q2, setQ2] = useState([])
  const [q2other, setQ2other] = useState('')
  const [q2buckets, setQ2buckets] = useState([])
  const [q3, setQ3] = useState([])

  // step 3/4 state
  const [path, setPath] = useState(null)
  const [baseline, setBaseline] = useState({})
  const [csvFile, setCsvFile] = useState(null)

  // AI bar
  const [aiInput, setAiInput] = useState('')

  const vw = useWindowWidth()
  const mobile = vw < 560

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    return () => document.documentElement.removeAttribute('data-theme')
  }, [theme])

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }

  // Navigation
  function canGoNext() {
    if (step === 2) {
      if (sub === 0) return q1.length > 0
      if (sub === 1) return true
      if (sub === 2) return q3.length > 0
    }
    if (step === 3) return path !== null
    return true
  }

  function next() {
    if (!canGoNext()) return
    if (step === 1) { setStep(2); setSub(0); return }
    if (step === 2) {
      if (sub < 2) { setSub(s => s + 1); return }
      setStep(3); return
    }
    if (step === 3) { setStep(4); return }
    if (step === 4) { setStep(5); return }
    if (step === 5 && onComplete) {
      const budgetBuckets = deriveBudgetBuckets(q2, q2other, q2buckets)
      const { periodOptions, periodDefault } = derivePeriods(q3)
      onComplete({
        focuses: q1,
        commitments: q2,
        commitmentOther: q2other,
        commitmentBuckets: q2buckets,
        planningHorizon: q3,
        dataPath: path,
        baseline,
        csvFile: csvFile ? { name: csvFile.name, rowCount: csvFile.rowCount, headers: csvFile.headers, raw: csvFile.raw } : null,
        budgetBuckets,
        periodOptions,
        periodDefault,
      })
      return
    }
  }

  function back() {
    if (step === 2 && sub > 0) { setSub(s => s - 1); return }
    if (step === 2 && sub === 0) { setStep(1); return }
    if (step === 3) { setStep(2); setSub(2); return }
    if (step === 4) { setStep(3); return }
    if (step === 5) { setStep(4); return }
  }

  const showBack = step > 1
  const enabled = canGoNext()

  const nextLabel = step === 1
    ? 'Get started →'
    : step === 5
      ? 'Build my dashboard →'
      : 'Continue →'

  // Step trail
  const trail = [1, 2, 3, 4, 5].map((n, i) => {
    const state = n < step ? 'done' : n === step ? 'active' : 'inactive'
    const dotStyle = {
      width: '24px',
      height: '24px',
      flexShrink: 0,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Mono', monospace",
      fontSize: '10px',
      transition: 'all .2s',
      ...(state === 'done'
        ? { background: 'var(--accent)', color: 'var(--accent-tx-on)', border: '1px solid var(--accent)' }
        : state === 'active'
          ? { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }
          : { background: 'transparent', color: 'var(--tx-3)', border: '1px solid var(--bd)' }),
    }
    const lineStyle = {
      width: i === 4 ? '0' : '22px',
      height: '1px',
      margin: '0 4px',
      background: n < step ? 'var(--accent)' : 'var(--bd)',
    }
    return { n, state, dotStyle, lineStyle }
  })

  // footer label — adapt for step 4
  const step4Label = path === 'manual' ? 'BASELINE' : 'IMPORT'
  const stepLabels = ['WELCOME', 'PRIORITIES', 'DATA PATH', step4Label, 'READY']
  const footerLabel = `STEP ${step} OF 5 · ${stepLabels[step - 1]}`

  const aiPlaceholder = getAiPlaceholder(step, sub, path)

  return (
    <div
      data-theme={theme}
      style={{
        fontFamily: 'Inter, sans-serif',
        background: 'var(--bg-app)',
        color: 'var(--tx-1)',
        minHeight: '100vh',
        height: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* ── Header ── */}
      <header style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 28px',
        borderBottom: '0.5px solid var(--bd)',
      }}>
        <div style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: '21px',
          color: 'var(--tx-1)',
          letterSpacing: '-0.01em',
        }}>
          AI Capital Planning OS
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Step trail */}
          {!mobile && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {trail.map(({ n, state, dotStyle, lineStyle }, i) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={dotStyle}>{state === 'done' ? '✓' : String(n)}</div>
                  {i < 4 && <div style={lineStyle} />}
                </div>
              ))}
            </div>
          )}
          {mobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              {trail.map(({ n, state }) => (
                <div
                  key={n}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: state === 'done' || state === 'active'
                      ? 'var(--accent)'
                      : 'var(--bd)',
                  }}
                />
              ))}
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'none',
              border: '0.5px solid var(--bd)',
              borderRadius: '6px',
              padding: '7px 11px',
              cursor: 'pointer',
              fontFamily: "'DM Mono', monospace",
              fontSize: '10px',
              color: 'var(--tx-2)',
              letterSpacing: '0.04em',
            }}
          >
            <span>{theme === 'light' ? 'LIGHT MODE' : 'DARK MODE'}</span>
            <span style={{ color: 'var(--accent)' }}>{theme === 'light' ? '☀' : '☾'}</span>
          </button>
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div style={{
        flex: 1,
        overflowY: step === 1 ? 'hidden' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: step === 1 ? 'center' : 'flex-start',
        padding: step === 1 ? '24px 24px' : '48px 24px',
      }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>

          {step === 1 && <Step1 onNext={next} />}

          {step === 2 && (
            <Step2
              sub={sub}
              q1={q1} setQ1={setQ1}
              q2={q2} setQ2={setQ2}
              q2other={q2other} setQ2other={setQ2other}
              q2buckets={q2buckets} setQ2buckets={setQ2buckets}
              q3={q3} setQ3={setQ3}
              mobile={mobile}
            />
          )}

          {step === 3 && <Step3 path={path} setPath={setPath} />}

          {step === 4 && (
            <Step4
              path={path}
              baseline={baseline}
              setBaseline={setBaseline}
              mobile={mobile}
              csvFile={csvFile}
              setCsvFile={setCsvFile}
            />
          )}

          {step === 5 && <Step5 />}

          {/* Nav row (hidden on step 1 — step 1 has its own CTA) */}
          {step > 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginTop: '30px',
              justifyContent: showBack ? 'space-between' : 'flex-end',
            }}>
              {showBack && (
                <button
                  onClick={back}
                  style={{
                    background: 'none',
                    border: '1px solid var(--ghost-bd)',
                    color: 'var(--ghost-txt)',
                    borderRadius: '8px',
                    padding: '12px 20px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  ← Back
                </button>
              )}
              <button
                onClick={next}
                disabled={!enabled}
                style={{
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px 24px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '13px',
                  fontWeight: 500,
                  transition: 'opacity .15s',
                  background: 'var(--accent)',
                  color: 'var(--accent-tx-on)',
                  cursor: enabled ? 'pointer' : 'not-allowed',
                  opacity: enabled ? 1 : 0.4,
                }}
              >
                {nextLabel}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── AI Setup Assistant bar ── */}
      <div style={{
        flexShrink: 0,
        background: 'var(--bg-card)',
        borderTop: '0.5px solid var(--bd)',
        padding: '10px 24px',
      }}>
        <div style={{ width: '100%', maxWidth: '480px', margin: '0 auto' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            border: '0.5px solid var(--accent-bd)',
            borderRadius: '9px',
            background: 'var(--accent-bg)',
            padding: '9px 14px',
          }}>
            <span style={{ color: 'var(--accent)', fontSize: '14px', flexShrink: 0 }}>✦</span>
            <input
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              placeholder={aiPlaceholder}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: 'var(--tx-1)',
                fontFamily: 'Inter, sans-serif',
                fontSize: '13px',
              }}
            />
            {!mobile && (
              <button
                onClick={() => setAiInput('Walk me through onboarding step by step')}
                style={{
                  flexShrink: 0,
                  background: 'none',
                  border: '0.5px solid var(--bd)',
                  borderRadius: '30px',
                  padding: '3px 9px',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '9px',
                  color: 'var(--tx-2)',
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Walk me through
              </button>
            )}
            {!mobile && (
              <span style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '10px',
                color: 'var(--tx-3)',
                border: '0.5px solid var(--bd)',
                borderRadius: '5px',
                padding: '3px 7px',
                flexShrink: 0,
              }}>
                ⌘K
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 28px',
        borderTop: '0.5px solid var(--bd)',
        fontFamily: "'DM Mono', monospace",
        fontSize: '9.5px',
        color: 'var(--tx-3)',
        letterSpacing: '0.06em',
      }}>
        <span>{footerLabel}</span>
        {!mobile && <span>AI Capital Planning OS · v1.0</span>}
      </footer>
    </div>
  )
}
