import { useState, useEffect, useRef } from 'react'
import { derivePeriods } from '../../lib/periods.js'
import { getImportHistory } from '../../lib/db/importLog.js'
import BudgetMapImport from '../import/BudgetMapImport.jsx'
import MonarchConnect from './MonarchConnect.jsx'
import ModuleHeader from '../common/ModuleHeader.jsx'

// Normalize legacy scalar planningHorizon (e.g. 3) into the multi-select array form.
function normalizeHorizon(h) {
  if (Array.isArray(h)) return h
  if (typeof h === 'number') return [h]
  return []
}

function toggle(arr, v) {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
}

// ── Constants (mirrored from Onboarding) ─────────────────────────────────────

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

// ── Settings Component ────────────────────────────────────────────────────────

function SettingsField({ label, prefix, suffix, value, onChange, placeholder, style }) {
  return (
    <div style={style}>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'var(--tx-3)',
        letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {prefix && (
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-3)' }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            background: 'var(--bg-app, #12141f)', border: '1px solid var(--bd, #2d3148)',
            borderRadius: 8, padding: '9px 12px', color: 'var(--tx-1, #e2e8f0)',
            fontSize: 14, fontFamily: "'DM Mono', monospace", outline: 'none',
            width: '100%', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums',
          }}
        />
        {suffix && (
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-3)' }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

export default function Settings({ profile, onSave, onBack, onImport, userId }) {
  // Accept both camelCase (onboarding) and snake_case (DB row) profile shapes.
  const [focuses, setFocuses] = useState(profile?.focuses || [])
  const [commitments, setCommitments] = useState(profile?.commitments || [])
  const [planningHorizon, setPlanningHorizon] = useState(
    normalizeHorizon(profile?.planningHorizon ?? profile?.planning_horizon)
  )
  // Income assumptions
  const [annualIncome, setAnnualIncome] = useState(
    profile?.annual_income != null ? String(Math.round(profile.annual_income)) : ''
  )
  const [annualBonus, setAnnualBonus] = useState(
    profile?.annual_bonus != null ? String(Math.round(profile.annual_bonus)) : ''
  )
  // Savings goal
  const [goalType, setGoalType] = useState(profile?.savings_goal_type ?? 'pct')
  const [goalAmount, setGoalAmount] = useState(
    profile?.savings_goal_amount != null ? String(Math.round(profile.savings_goal_amount)) : ''
  )
  const [goalPct, setGoalPct] = useState(
    profile?.savings_goal_pct != null ? String(profile.savings_goal_pct) : ''
  )
  const [saved, setSaved] = useState(false)
  const [importHistory, setImportHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!userId) return
    setHistoryLoading(true)
    getImportHistory(userId)
      .then(setImportHistory)
      .catch(() => setImportHistory([]))
      .finally(() => setHistoryLoading(false))
  }, [userId])

  function handleImportFile(file) {
    if (!file || !onImport) return
    const reader = new FileReader()
    reader.onload = e => onImport(e.target.result, file.name)
    reader.readAsText(file)
  }

  const allAboveSel = Q1_BASE.every(b => focuses.includes(b))

  function clickQ1(label) {
    if (label === 'All of the above') {
      const allSel = Q1_BASE.every(b => focuses.includes(b))
      setFocuses(allSel ? [] : [...Q1_BASE])
    } else {
      setFocuses(prev =>
        prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
      )
    }
  }

  function clickQ2(label) {
    if (label === 'None currently') {
      setCommitments(prev => prev.includes('None currently') ? [] : ['None currently'])
    } else {
      setCommitments(prev => {
        const without = prev.filter(x => x !== 'None currently')
        return without.includes(label) ? without.filter(x => x !== label) : [...without, label]
      })
    }
  }

  function handleSave() {
    const { periodOptions, periodDefault } = derivePeriods(planningHorizon)
    const updated = {
      ...(profile || {}),
      focuses,
      commitments,
      planningHorizon,
      periodOptions,
      periodDefault,
      annualIncome: parseFloat(annualIncome) || null,
      annualBonus: parseFloat(annualBonus) || null,
      savingsGoalAmount: parseFloat(goalAmount) || null,
      savingsGoalPct: parseFloat(goalPct) || null,
      savingsGoalType: goalType,
    }
    onSave(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleGoalAmountChange(val) {
    setGoalAmount(val)
    const income = parseFloat(annualIncome) || 0
    if (income > 0) {
      const pct = (parseFloat(val) || 0) / income * 100
      setGoalPct(pct > 0 ? pct.toFixed(1) : '')
    }
  }

  function handleGoalPctChange(val) {
    setGoalPct(val)
    const income = parseFloat(annualIncome) || 0
    const amount = income * (parseFloat(val) || 0) / 100
    setGoalAmount(amount > 0 ? String(Math.round(amount)) : '')
  }

  function handleIncomeChange(val) {
    setAnnualIncome(val)
    // Re-derive the goal's secondary value when income changes
    const income = parseFloat(val) || 0
    if (goalType === 'pct' && goalPct && income > 0) {
      const amount = income * (parseFloat(goalPct) || 0) / 100
      setGoalAmount(amount > 0 ? String(Math.round(amount)) : '')
    } else if (goalType === 'amount' && goalAmount && income > 0) {
      const pct = (parseFloat(goalAmount) || 0) / income * 100
      setGoalPct(pct > 0 ? pct.toFixed(1) : '')
    }
  }

  const card = {
    background: 'var(--bg-card, #1e2130)',
    border: '1px solid var(--bd, #2d3148)',
    borderRadius: '12px',
    padding: '22px 24px',
    marginBottom: '20px',
  }

  const cardTitle = {
    fontFamily: "'DM Mono', monospace",
    fontSize: '10px',
    color: 'var(--tx-3)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '14px',
  }

  const chipBase = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '11px 14px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--tx-1, #e2e8f0)',
    marginBottom: '8px',
    userSelect: 'none',
    transition: 'border-color .15s, background .15s',
  }

  const chipSel = {
    border: '1px solid var(--accent, #00C2A8)',
    background: 'var(--accent-bg, rgba(0,194,168,0.08))',
  }

  const chipUnsel = {
    border: '1px solid var(--bd, #2d3148)',
    background: 'var(--bg-card, #1e2130)',
  }

  const indBase = {
    width: '18px',
    height: '18px',
    flexShrink: 0,
    borderRadius: '5px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 500,
  }

  const indSel = {
    background: 'var(--accent, #00C2A8)',
    border: '1px solid var(--accent, #00C2A8)',
    color: '#fff',
  }

  const indUnsel = {
    border: '1px solid var(--tx-3, #475569)',
    color: 'transparent',
  }

  return (
    <div style={{
      fontFamily: 'Inter, sans-serif',
      maxWidth: '560px',
      padding: '32px 0',
    }}>
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: "'DM Mono', monospace",
          fontSize: '11px',
          color: 'var(--tx-3, #475569)',
          letterSpacing: '0.04em',
          padding: '0 0 20px',
          display: 'block',
        }}
      >
        ← Dashboard
      </button>

      {/* Page heading */}
      <ModuleHeader
        icon="⚙"
        title="Settings"
        subtitle="Preferences, data management, and account connections."
      />

      {/* Section 1: Financial Focuses */}
      <div style={card}>
        <div style={cardTitle}>FINANCIAL FOCUSES</div>
        {Q1_OPTS.map(label => {
          const sel = label === 'All of the above' ? allAboveSel : focuses.includes(label)
          return (
            <div
              key={label}
              onClick={() => clickQ1(label)}
              style={{ ...chipBase, ...(sel ? chipSel : chipUnsel) }}
            >
              <div style={{ ...indBase, ...(sel ? indSel : indUnsel) }}>
                {sel ? '✓' : ''}
              </div>
              <span>{label}</span>
            </div>
          )
        })}
      </div>

      {/* Section 2: Long-Term Commitments */}
      <div style={card}>
        <div style={cardTitle}>LONG-TERM COMMITMENTS</div>
        {Q2_OPTS.map(label => {
          const sel = commitments.includes(label)
          return (
            <div
              key={label}
              onClick={() => clickQ2(label)}
              style={{ ...chipBase, ...(sel ? chipSel : chipUnsel) }}
            >
              <div style={{ ...indBase, ...(sel ? indSel : indUnsel) }}>
                {sel ? '✓' : ''}
              </div>
              <span>{label}</span>
            </div>
          )
        })}
      </div>

      {/* Section 3: Planning Horizon */}
      <div style={card}>
        <div style={cardTitle}>PLANNING HORIZON</div>
        <div style={{
          fontSize: '12px',
          color: 'var(--tx-3, #475569)',
          marginBottom: '14px',
          fontFamily: "'DM Mono', monospace",
          letterSpacing: '0.02em',
        }}>
          SELECT ANY THAT APPLY — EACH BECOMES A DASHBOARD PERIOD FILTER
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '8px',
        }}>
          {[1,2,3,4,5,6,7,8,9,10].map(yr => {
            const sel = planningHorizon.includes(yr)
            return (
              <div
                key={yr}
                onClick={() => setPlanningHorizon(toggle(planningHorizon, yr))}
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
                  border: sel ? '1px solid var(--accent, #00C2A8)' : '1px solid var(--bd, #2d3148)',
                  background: sel ? 'var(--accent-bg, rgba(0,194,168,0.08))' : 'var(--bg-card, #1e2130)',
                  color: sel ? 'var(--accent, #00C2A8)' : 'var(--tx-2, #94a3b8)',
                }}
              >
                {yr}
              </div>
            )
          })}
        </div>
        {planningHorizon.length > 0 && (() => {
          const { periodOptions, periodDefault } = derivePeriods(planningHorizon)
          return (
            <div style={{
              marginTop: '14px',
              fontFamily: "'DM Mono', monospace",
              fontSize: '10px',
              color: 'var(--tx-3, #475569)',
              letterSpacing: '0.04em',
            }}>
              {`DASHBOARD WILL SHOW ${periodOptions.join(' · ')} PERIOD OPTIONS · DEFAULTS TO ${periodDefault}`}
            </div>
          )
        })()}
      </div>

      {/* Section 4: Data Path */}
      <div style={card}>
        <div style={cardTitle}>DATA PATH</div>
        <div style={{
          fontSize: '13px',
          color: 'var(--tx-1, #e2e8f0)',
          marginBottom: '8px',
        }}>
          {profile?.dataPath
            ? profile.dataPath === 'import' ? 'Import transaction history'
              : profile.dataPath === 'partial' ? 'Import + set manual baseline'
              : 'Start with manual baseline only'
            : 'Not set'}
        </div>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '10px',
          color: 'var(--tx-3, #475569)',
          letterSpacing: '0.02em',
        }}>
          Re-import data in Data Management to change this.
        </div>
      </div>

      {/* Section 5: Connections */}
      {onImport && (
        <div style={card}>
          <div style={cardTitle}>CONNECTIONS</div>
          <MonarchConnect onImport={onImport} />
        </div>
      )}

      {/* Section 6: Data Management */}
      <div style={card}>
        <div style={cardTitle}>DATA MANAGEMENT</div>

        {/* CSV Re-import drop zone */}
        {onImport && (
          <>
            <div style={{
              fontSize: '13px',
              color: 'var(--tx-2, #94a3b8)',
              marginBottom: '14px',
              lineHeight: '1.6',
            }}>
              Import an additional Monarch Money CSV export. Duplicates are automatically skipped.
            </div>
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={e => handleImportFile(e.target.files[0])}
            />
            <div
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault()
                setDragOver(false)
                handleImportFile(e.dataTransfer.files[0])
              }}
              style={{
                border: dragOver
                  ? '1.5px dashed var(--accent, #00C2A8)'
                  : '1.5px dashed var(--bd, #2d3148)',
                borderRadius: '10px',
                padding: '28px 20px',
                textAlign: 'center',
                background: 'var(--bg-app, #12141f)',
                cursor: 'pointer',
                transition: 'border-color .15s',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontSize: '22px', color: 'var(--accent, #00C2A8)', lineHeight: 1 }}>↑</div>
              <div style={{ fontSize: '13px', color: 'var(--tx-1, #e2e8f0)', marginTop: '10px', fontWeight: 500 }}>
                Drop CSV here or click to browse
              </div>
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '9.5px',
                color: 'var(--tx-3, #475569)',
                marginTop: '6px',
                letterSpacing: '0.04em',
              }}>
                MONARCH MONEY EXPORT FORMAT
              </div>
            </div>
          </>
        )}

        {/* Import history */}
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '9.5px',
          color: 'var(--tx-3, #475569)',
          letterSpacing: '0.05em',
          marginBottom: '10px',
        }}>
          IMPORT HISTORY
        </div>

        {historyLoading ? (
          <div style={{ fontSize: '12px', color: 'var(--tx-3, #475569)' }}>Loading…</div>
        ) : importHistory.length === 0 ? (
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '11px',
            color: 'var(--tx-3, #475569)',
          }}>
            No imports yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {importHistory.map(log => (
              <div key={log.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 0',
                borderBottom: '0.5px solid var(--bd-light, #1a1d2e)',
                gap: '12px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '12.5px',
                    color: 'var(--tx-1, #e2e8f0)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {log.filename ?? 'CSV import'}
                  </div>
                  <div style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '9.5px',
                    color: 'var(--tx-3, #475569)',
                    marginTop: '2px',
                  }}>
                    {new Date(log.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '11px',
                    color: 'var(--accent, #00C2A8)',
                  }}>
                    +{log.inserted.toLocaleString()}
                  </div>
                  <div style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '9.5px',
                    color: 'var(--tx-3, #475569)',
                  }}>
                    {log.skipped.toLocaleString()} skipped
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 6: Category Map */}
      {userId && (
        <div style={card}>
          <div style={cardTitle}>CATEGORY MAP</div>
          <div style={{
            fontSize: '13px',
            color: 'var(--tx-2, #94a3b8)',
            marginBottom: '14px',
            lineHeight: '1.6',
          }}>
            Already map your categories to budget groups in a spreadsheet? Import it
            here — it becomes the authoritative mapping, so future imports map cleanly
            without AI guessing.
          </div>
          <BudgetMapImport userId={userId} />
        </div>
      )}

      {/* Section: Income Assumptions */}
      <div style={card}>
        <div style={cardTitle}>INCOME ASSUMPTIONS</div>
        <div style={{ fontSize: '12.5px', color: 'var(--tx-3)', marginBottom: '16px', lineHeight: 1.5 }}>
          Used to calculate savings rate goals and inform AI analysis.
        </div>
        <SettingsField
          label="Total expected annual income"
          prefix="$"
          value={annualIncome}
          onChange={handleIncomeChange}
          placeholder="e.g. 120000"
        />
        <SettingsField
          label="Expected annual bonus"
          prefix="$"
          value={annualBonus}
          onChange={setAnnualBonus}
          placeholder="e.g. 15000"
          style={{ marginTop: 12 }}
        />
      </div>

      {/* Section: Goals */}
      <div style={card}>
        <div style={cardTitle}>SAVINGS GOAL</div>
        <div style={{ fontSize: '12.5px', color: 'var(--tx-3)', marginBottom: '16px', lineHeight: 1.5 }}>
          Set a savings target — enter either the dollar amount or percentage; the other auto-calculates from your income.
        </div>
        {/* $ / % toggle */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden', width: 'fit-content', marginBottom: 16 }}>
          {[{ id: 'amount', label: '$' }, { id: 'pct', label: '%' }].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setGoalType(id)}
              style={{
                padding: '7px 20px', background: goalType === id ? 'var(--accent)' : 'transparent',
                color: goalType === id ? '#fff' : 'var(--tx-2)',
                border: 'none', borderRight: id === 'amount' ? '1px solid var(--bd)' : 'none',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {goalType === 'amount' ? (
          <>
            <SettingsField
              label="Annual savings target"
              prefix="$"
              value={goalAmount}
              onChange={handleGoalAmountChange}
              placeholder="e.g. 30000"
            />
            {goalPct && annualIncome && (
              <div style={{ fontSize: 12, color: 'var(--tx-3)', marginTop: 8 }}>
                = {goalPct}% of annual income
              </div>
            )}
          </>
        ) : (
          <>
            <SettingsField
              label="Savings rate goal"
              suffix="%"
              value={goalPct}
              onChange={handleGoalPctChange}
              placeholder="e.g. 25"
            />
            {goalAmount && annualIncome && (
              <div style={{ fontSize: 12, color: 'var(--tx-3)', marginTop: 8 }}>
                = ${Math.round(parseFloat(goalAmount) || 0).toLocaleString()} saved annually
              </div>
            )}
          </>
        )}
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        style={{
          background: saved ? 'var(--accent, #00C2A8)' : 'var(--accent, #00C2A8)',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          padding: '13px 28px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'opacity .15s',
        }}
      >
        {saved ? 'Saved ✓' : 'Save changes'}
      </button>
    </div>
  )
}
