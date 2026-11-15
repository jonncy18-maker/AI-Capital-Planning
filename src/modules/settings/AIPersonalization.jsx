import { useState, useEffect } from 'react'
import { getAIPreferences, saveAIPreferences } from '../../lib/db/aiPreferences.js'
import { normalizePreferences, hasPreferences, VERBOSITY_OPTIONS } from '../../lib/ai/preferences.js'

// ── Shared styling helpers ────────────────────────────────────────────────────
const label = {
  fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)',
  letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6,
}
const inputBase = {
  width: '100%', background: 'var(--field)', border: '1px solid var(--bd)',
  borderRadius: 8, padding: '9px 11px', color: 'var(--tx-1)',
  fontFamily: 'Inter, sans-serif', fontSize: 13, outline: 'none',
}
const btnPrimary = {
  background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
  borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
}

// Comma-separated list editor backed by a string[] value.
function ListField({ title, hint, value, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={label}>{title}</div>
      <input
        style={inputBase}
        value={(value || []).join(', ')}
        placeholder={hint}
        onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
      />
    </div>
  )
}

// ── Editable preferences form (controlled) ────────────────────────────────────
export function AIPrefsForm({ value, onChange }) {
  const v = value || {}
  const set = (patch) => onChange({ ...v, ...patch })
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={label}>Tone</div>
        <input
          style={inputBase}
          value={v.tone || ''}
          placeholder="e.g. direct and blunt, encouraging, analytical…"
          onChange={e => set({ tone: e.target.value })}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={label}>Length</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {VERBOSITY_OPTIONS.map(opt => {
            const sel = (v.verbosity || 'standard') === opt
            return (
              <button
                key={opt}
                onClick={() => set({ verbosity: opt })}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 7, cursor: 'pointer',
                  fontSize: 12, fontWeight: sel ? 600 : 400, textTransform: 'capitalize',
                  border: sel ? '1px solid var(--accent)' : '1px solid var(--bd)',
                  background: sel ? 'var(--accent-bg)' : 'var(--field)',
                  color: sel ? 'var(--accent)' : 'var(--tx-2)',
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      </div>

      <ListField title="Prioritize" hint="cash flow timing, wealth growth…" value={v.priorities} onChange={priorities => set({ priorities })} />
      <ListField title="Always surface" hint="commitment spikes, savings-rate drops…" value={v.surface} onChange={surface => set({ surface })} />
      <ListField title="De-emphasize" hint="day-to-day discretionary noise…" value={v.ignore} onChange={ignore => set({ ignore })} />

      <div>
        <div style={label}>Other framing guidance</div>
        <textarea
          style={{ ...inputBase, minHeight: 64, resize: 'vertical', lineHeight: 1.5 }}
          value={v.notes || ''}
          placeholder="Anything else about how you want AI output framed…"
          onChange={e => set({ notes: e.target.value })}
        />
      </div>
    </div>
  )
}

// ── Panel: loads/saves the editable preferences ───────────────────────────────
export function AIPersonalizationPanel({ userId, onChange, compact = false }) {
  const [prefs, setPrefs] = useState(normalizePreferences({}))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAIPreferences(userId)
      .then(p => { if (!cancelled) { setPrefs(normalizePreferences(p.preferences)) } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  async function persist(nextPrefs) {
    setSaving(true)
    try {
      await saveAIPreferences(userId, { preferences: nextPrefs })
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
      onChange?.()
    } catch {
      // best-effort; the UI keeps the local edits regardless
    } finally {
      setSaving(false)
    }
  }

  function handleSave() { persist(prefs) }

  if (loading) {
    return <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-3)' }}>Loading…</div>
  }

  const personalized = hasPreferences(prefs)

  return (
    <div>
      {!compact && (
        <div style={{ fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.6, marginBottom: 16 }}>
          Set how AI output is framed: tone, length and what to prioritize. These preferences shape
          the AI helpers across the app.
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: compact ? '10px 0 14px' : '0 0 16px',
      }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx-1)' }}>
            {personalized ? 'Personalized' : 'Not yet personalized'}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--tx-3)', marginTop: 2 }}>
            {personalized ? 'The AI is honoring your preferences' : 'The AI is using neutral defaults'}
          </div>
        </div>
      </div>

      <AIPrefsForm value={prefs} onChange={setPrefs} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18 }}>
        <span style={{ fontSize: 11.5, color: saved ? 'var(--accent)' : 'var(--tx-3)' }}>
          {saved ? 'Saved ✓' : saving ? 'Saving…' : ''}
        </span>
        <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          Save preferences
        </button>
      </div>
    </div>
  )
}

// Default export: the Settings-page section wrapper.
export default function AIPersonalization({ userId, onChange }) {
  return <AIPersonalizationPanel userId={userId} onChange={onChange} compact={false} />
}
