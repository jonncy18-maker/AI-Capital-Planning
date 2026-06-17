import { useState } from 'react'
import { derivePeriods } from '../../lib/periods.js'

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

export default function Settings({ profile, onSave, onBack }) {
  const [focuses, setFocuses] = useState(profile?.focuses || [])
  const [commitments, setCommitments] = useState(profile?.commitments || [])
  const [planningHorizon, setPlanningHorizon] = useState(normalizeHorizon(profile?.planningHorizon))
  const [saved, setSaved] = useState(false)

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
    }
    onSave(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
    color: 'var(--accent, #00C2A8)',
    letterSpacing: '0.1em',
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
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '26px',
        lineHeight: '1.2',
        color: 'var(--tx-1, #e2e8f0)',
        letterSpacing: '-0.01em',
        marginBottom: '28px',
      }}>
        Settings
      </div>

      {/* Section 1: Financial Focuses */}
      <div style={card}>
        <div style={cardTitle}>// FINANCIAL FOCUSES</div>
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
        <div style={cardTitle}>// LONG-TERM COMMITMENTS</div>
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
        <div style={cardTitle}>// PLANNING HORIZON</div>
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
        <div style={cardTitle}>// DATA PATH</div>
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
