import { useState, useEffect, useMemo } from 'react'
import { getBudgetCategories, upsertCategory } from '../../lib/db/budgetCategories.js'
import { ALL_GROUPS } from '../../lib/csv/categoryMap.js'
import BudgetMapImport from '../import/BudgetMapImport.jsx'
import ModuleHeader from '../common/ModuleHeader.jsx'

const TYPES = ['Fixed', 'Flexible', 'Non-Monthly']

// Mapping module — the standing home for reviewing and editing how categories
// map to budget groups, plus importing an existing budget/category map. Groups
// are flexible: whatever the user already uses, plus the built-in defaults, plus
// any new group typed inline.
export default function Mapping({ userId, mobile }) {
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [edits, setEdits] = useState({}) // category -> { group, type }
  const [customNew, setCustomNew] = useState({}) // category -> typing a new group
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function load() {
    setLoading(true)
    getBudgetCategories(userId)
      .then(d => setCats(d))
      .catch(() => setCats([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (userId) load()
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const groupOptions = useMemo(() => {
    const fromCats = cats.map(c => c.group).filter(Boolean)
    const fromEdits = Object.values(edits).map(e => e.group).filter(Boolean)
    return [...new Set([...fromCats, ...fromEdits, ...ALL_GROUPS])]
  }, [cats, edits])

  function effective(c) {
    const e = edits[c.category]
    return {
      group: e?.group ?? c.group ?? 'Uncategorized',
      type: e?.type ?? c.type ?? 'Flexible',
      exclude: e?.exclude ?? !!c.exclude_from_totals,
    }
  }

  function changed(c) {
    const e = edits[c.category]
    if (!e) return false
    return e.group !== (c.group ?? 'Uncategorized')
      || e.type !== (c.type ?? 'Flexible')
      || e.exclude !== !!c.exclude_from_totals
  }

  function setField(c, patch) {
    setEdits(prev => ({ ...prev, [c.category]: { ...effective(c), ...patch } }))
  }

  const dirtyCount = cats.filter(changed).length

  async function save() {
    setSaving(true)
    try {
      for (const c of cats) {
        if (!changed(c)) continue
        const e = effective(c)
        await upsertCategory(userId, { category: c.category, group: e.group, type: e.type, excludeFromTotals: e.exclude })
      }
      setEdits({})
      setCustomNew({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      load()
    } finally {
      setSaving(false)
    }
  }

  // Sort by group, then category, for a stable grouped view.
  const sorted = useMemo(
    () => [...cats].sort((a, b) =>
      (a.group ?? '').localeCompare(b.group ?? '') || a.category.localeCompare(b.category)
    ),
    [cats]
  )

  const card = {
    border: '1px solid var(--bd)',
    borderRadius: '14px',
    background: 'var(--bg-card)',
    padding: '22px 24px',
    marginBottom: '20px',
  }
  // Calmer in-card section label — replaces the old tiny teal "// xxx" eyebrows.
  const eyebrow = {
    fontFamily: "'DM Mono', monospace",
    fontSize: '10px',
    color: 'var(--tx-3)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '14px',
  }
  const selectStyle = {
    background: 'var(--field)',
    border: '1px solid var(--bd)',
    borderRadius: '7px',
    padding: '7px 9px',
    fontFamily: 'Inter, sans-serif',
    fontSize: '12.5px',
    color: 'var(--tx-1)',
    cursor: 'pointer',
    outline: 'none',
  }

  return (
    <div style={{ maxWidth: '720px', padding: '8px 0 96px' }}>
      <ModuleHeader
        mobile={mobile}
        icon="⊹"
        title="Category Mapping"
        subtitle="Control how your categories roll up into budget groups."
      />
      <div style={{ fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.6, marginBottom: '22px', maxWidth: 600 }}>
        Groups are yours — pick an existing one, or add a new bucket. These mappings
        drive the budget, forecasts, and AI briefings. Mark transfers or credit-card
        payments as <em>exclude</em> so they don't overstate your spend and income.
      </div>

      {/* Import existing budget / map */}
      <div style={card}>
        <div style={eyebrow}>Import a budget / category map</div>
        <div style={{ fontSize: '12.5px', color: 'var(--tx-2)', lineHeight: 1.6, marginBottom: '14px' }}>
          Maintain your buckets in a spreadsheet? Import it as the authoritative map.
        </div>
        <BudgetMapImport userId={userId} compact onImported={() => load()} />
      </div>

      {/* Current mappings */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ ...eyebrow, marginBottom: 0 }}>Current mappings ({cats.length})</div>
          {dirtyCount > 0 && (
            <button
              onClick={save}
              disabled={saving}
              style={{
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--accent-tx-on)',
                borderRadius: '8px',
                padding: '8px 16px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '12.5px',
                fontWeight: 500,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}
            </button>
          )}
          {dirtyCount === 0 && saved && (
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'var(--accent)' }}>
              ✓ Saved
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ fontSize: '12px', color: 'var(--tx-3)' }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'var(--tx-3)', lineHeight: 1.7 }}>
            No categories yet. Import a budget map above, or import transactions from
            Settings to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sorted.map(c => {
              const e = effective(c)
              const isNew = customNew[c.category]
              const opts = [...new Set([...groupOptions, e.group].filter(Boolean))]
              return (
                <div
                  key={c.category}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 130px 96px',
                    gap: '8px',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '0.5px solid var(--bd-light)',
                    opacity: e.exclude ? 0.6 : 1,
                  }}
                >
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--tx-1)',
                    fontWeight: changed(c) ? 600 : 400,
                  }}>
                    {c.category}
                    {changed(c) && <span style={{ color: 'var(--accent)' }}> •</span>}
                  </div>

                  {isNew ? (
                    <input
                      autoFocus
                      value={e.group}
                      onChange={ev => setField(c, { group: ev.target.value })}
                      placeholder="New group name…"
                      style={{ ...selectStyle, border: '1px solid var(--accent)', cursor: 'text' }}
                    />
                  ) : (
                    <select
                      value={e.group}
                      onChange={ev => {
                        if (ev.target.value === '__new__') {
                          setCustomNew(s => ({ ...s, [c.category]: true }))
                          setField(c, { group: '' })
                        } else {
                          setField(c, { group: ev.target.value })
                        }
                      }}
                      style={selectStyle}
                    >
                      {opts.map(g => <option key={g} value={g}>{g}</option>)}
                      <option value="__new__">+ New group…</option>
                    </select>
                  )}

                  <select
                    value={e.type}
                    onChange={ev => setField(c, { type: ev.target.value })}
                    style={selectStyle}
                  >
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <label
                    title="Exclude from spend & income totals (e.g. transfers, credit-card payments)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                      fontFamily: "'DM Mono', monospace", fontSize: '10px',
                      letterSpacing: '0.04em', color: e.exclude ? 'var(--accent)' : 'var(--tx-3)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={e.exclude}
                      onChange={ev => setField(c, { exclude: ev.target.checked })}
                      style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    exclude
                  </label>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
