import { useState, useEffect, useRef } from 'react'
import { getAIPreferences, saveAIPreferences } from '../../lib/db/aiPreferences.js'
import { normalizePreferences, hasPreferences, VERBOSITY_OPTIONS } from '../../lib/ai/preferences.js'
import { runGrillTurn, synthesizePreferences } from '../../lib/ai/grill.js'

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
const btnGhost = {
  background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent-bd)',
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

// ── Conversational personalization interview ("grill me") ─────────────────────
const KICKOFF = "I'm ready — start the personalization interview."

export function GrillInterview({ userId, context, onClose, onSaved }) {
  // turns: visible thread, excluding the hidden kickoff trigger.
  const [turns, setTurns] = useState([]) // { role, content }
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState('loading') // loading | chatting | synthesizing | error
  const [error, setError] = useState(null)
  const [answered, setAnswered] = useState(0)
  const scrollRef = useRef(null)
  const startedRef = useRef(false)

  // Full message history sent to the model (includes the hidden kickoff).
  const historyRef = useRef([{ role: 'user', content: KICKOFF }])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    ;(async () => {
      const res = await runGrillTurn({ messages: historyRef.current, context })
      if (res.status !== 'ok' || !res.text) {
        setError(res.text || 'Could not start the interview.'); setPhase('error'); return
      }
      historyRef.current.push({ role: 'assistant', content: res.text })
      setTurns([{ role: 'assistant', content: res.text }])
      setPhase('chatting')
    })()
  }, [context])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, phase])

  async function submitAnswer() {
    const text = input.trim()
    if (!text || phase !== 'chatting') return
    setInput('')
    const nextTurns = [...turns, { role: 'user', content: text }]
    setTurns(nextTurns)
    setAnswered(a => a + 1)
    historyRef.current.push({ role: 'user', content: text })
    setPhase('thinking')
    const res = await runGrillTurn({ messages: historyRef.current, context })
    if (res.status !== 'ok' || !res.text) {
      setError(res.text || 'The interview hit a snag. You can still finish and save.'); setPhase('chatting'); return
    }
    historyRef.current.push({ role: 'assistant', content: res.text })
    setTurns([...nextTurns, { role: 'assistant', content: res.text }])
    setPhase('chatting')
  }

  async function finish() {
    setPhase('synthesizing')
    setError(null)
    const res = await synthesizePreferences({ messages: historyRef.current, context })
    if (res.status !== 'ok' || !res.preferences) {
      setError(res.text || 'Could not save your preferences.'); setPhase('chatting'); return
    }
    const prefs = normalizePreferences(res.preferences)
    try {
      await saveAIPreferences(userId, {
        preferences: prefs,
        grill_enabled: true,
        interview: { transcript: historyRef.current, completed_at: new Date().toISOString() },
      })
    } catch {
      // Saved-state failure shouldn't lose the synthesized prefs — surface them anyway.
    }
    onSaved(prefs)
  }

  const busy = phase === 'thinking' || phase === 'synthesizing'

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-card)', border: '1px solid var(--accent-bd)', borderRadius: 14,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ color: 'var(--accent)', fontSize: 14 }}>✦</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>Personalize my AI</div>
              <div style={{ fontSize: 10.5, color: 'var(--tx-3)', marginTop: 1 }}>A few pointed questions to align your briefings</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tx-3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {phase === 'loading' && (
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-3)' }}>Scanning your data…</div>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <span style={{
                flexShrink: 0, width: 30, fontFamily: "'DM Mono', monospace", fontSize: 9,
                color: t.role === 'assistant' ? 'var(--accent)' : 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 3,
              }}>{t.role === 'assistant' ? '✦ AI' : 'YOU'}</span>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: t.role === 'assistant' ? 'var(--tx-1)' : 'var(--tx-2)', whiteSpace: 'pre-wrap', minWidth: 0 }}>
                {t.content}
              </div>
            </div>
          ))}
          {phase === 'thinking' && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, color: 'var(--tx-3)' }}>Thinking…</div>}
          {phase === 'synthesizing' && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, color: 'var(--accent)' }}>Synthesizing your preferences…</div>}
          {error && <div style={{ fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.5 }}>{error}</div>}
        </div>

        {phase !== 'error' && (
          <div style={{ borderTop: '1px solid var(--bd)', padding: '12px 16px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitAnswer() }}
                disabled={busy || phase === 'loading'}
                placeholder="Type your answer…"
                style={{ ...inputBase, flex: 1 }}
              />
              <button onClick={submitAnswer} disabled={busy || phase === 'loading' || !input.trim()} style={{
                ...btnPrimary, opacity: (busy || !input.trim()) ? 0.5 : 1, cursor: (busy || !input.trim()) ? 'default' : 'pointer',
              }}>Send</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.04em' }}>
                {answered === 0 ? 'ANSWER TO BEGIN' : `${answered} ANSWERED`}
              </span>
              <button onClick={finish} disabled={busy || answered === 0} style={{
                ...btnGhost, padding: '7px 13px', fontSize: 11.5,
                opacity: (busy || answered === 0) ? 0.5 : 1, cursor: (busy || answered === 0) ? 'default' : 'pointer',
              }}>Finish & save →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Panel: loads/saves prefs, hosts the form + interview launcher ─────────────
// Used both in Settings (compact=false) and the global command-bar popover.
export function AIPersonalizationPanel({ userId, context, onChange, compact = false }) {
  const [prefs, setPrefs] = useState(normalizePreferences({}))
  const [grillEnabled, setGrillEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [interviewOpen, setInterviewOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAIPreferences(userId)
      .then(p => { if (!cancelled) { setPrefs(normalizePreferences(p.preferences)); setGrillEnabled(p.grill_enabled) } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  async function persist(nextPrefs, nextGrill) {
    setSaving(true)
    try {
      await saveAIPreferences(userId, { preferences: nextPrefs, grill_enabled: nextGrill })
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
      onChange?.()
    } catch {
      // best-effort; the UI keeps the local edits regardless
    } finally {
      setSaving(false)
    }
  }

  function handleSave() { persist(prefs, grillEnabled) }

  function handleInterviewSaved(newPrefs) {
    setPrefs(newPrefs)
    setGrillEnabled(true)
    setInterviewOpen(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
    onChange?.()
  }

  if (loading) {
    return <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-3)' }}>Loading…</div>
  }

  const personalized = hasPreferences(prefs)

  return (
    <div>
      {!compact && (
        <div style={{ fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.6, marginBottom: 16 }}>
          Run a short, pointed interview where the AI scans your data, surfaces the patterns it sees, and
          asks what you actually want from your briefings. Your answers tune every AI briefing and answer
          across the app. You can also edit the dials directly below.
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
        <button onClick={() => setInterviewOpen(true)} style={btnPrimary}>
          {personalized ? '↻ Re-run interview' : '✦ Personalize my AI'}
        </button>
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

      {interviewOpen && (
        <GrillInterview
          userId={userId}
          context={context}
          onClose={() => setInterviewOpen(false)}
          onSaved={handleInterviewSaved}
        />
      )}
    </div>
  )
}

// Default export: the Settings-page section wrapper.
export default function AIPersonalization({ userId, context, onChange }) {
  return <AIPersonalizationPanel userId={userId} context={context} onChange={onChange} compact={false} />
}
