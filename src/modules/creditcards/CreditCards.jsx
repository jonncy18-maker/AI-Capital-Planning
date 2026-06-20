import { useState, useEffect, useMemo, useCallback } from 'react'
import ModuleHeader from '../common/ModuleHeader.jsx'
import {
  getCreditCards, upsertCreditCard, deleteCreditCard,
  getEarnRates, upsertEarnRate,
  getPointsBalances, upsertPointsBalance,
  getPointRedemptions, upsertPointRedemption, deletePointRedemption,
  getCCSettings, updateCCSettings,
  buildEarnRateMap,
} from '../../lib/db/creditCards.js'
import { getBudgetCategories } from '../../lib/db/budgetCategories.js'
import { supabase } from '../../lib/supabase.js'
import {
  computePointsForecast,
  estimateTotalValue,
  estimateMonthlyEarnRate,
  CC_CATEGORIES,
} from '../../lib/creditcards/pointsEngine.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']
const NETWORKS = ['visa','mastercard','amex','discover','other']
const NETWORK_LABELS = { visa:'Visa', mastercard:'MasterCard', amex:'Amex', discover:'Discover', other:'Other' }
const CARD_COLORS = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EF4444','#06B6D4','#F97316','#EC4899']

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = n => n == null ? '—' : '$' + Math.abs(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 0 })
const fmtPts = n => n == null ? '—' : Math.round(n).toLocaleString() + ' pts'
const fmtK = n => {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + Math.round(n).toLocaleString()
}

function ordinal(n) {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 28, borderBottom: '1px solid var(--bd)' }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '8px 14px', marginBottom: -1,
          fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: '0.05em',
          color: active === t.id ? 'var(--tx-1)' : 'var(--tx-3)',
          borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
          transition: 'color 0.15s',
        }}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function MonoLabel({ children, style }) {
  return (
    <div style={{
      fontFamily: "'DM Mono', monospace", fontSize: 9.5,
      color: 'var(--tx-3)', letterSpacing: '0.06em', ...style,
    }}>
      {children}
    </div>
  )
}

function StatBox({ label, value, sub, accent }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--bg-card)',
      padding: '16px 18px', minWidth: 0,
    }}>
      <MonoLabel>{label}</MonoLabel>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: 28, color: accent ? 'var(--accent)' : 'var(--tx-1)',
        marginTop: 6, lineHeight: 1,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function CardChip({ card }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: (card.color || '#3B82F6') + '22',
      border: `1px solid ${card.color || '#3B82F6'}44`,
      borderRadius: 6, padding: '3px 8px',
    }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: card.color || '#3B82F6' }} />
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-2)' }}>
        {card.name}
      </span>
    </div>
  )
}

function Slider({ label, value, onChange, hint }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <MonoLabel>{label}</MonoLabel>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
          {value}%
        </span>
      </div>
      <input
        type="range" min={0} max={100} step={5} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
      {hint && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-4)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em',
      color: 'var(--tx-3)', marginBottom: 12, textTransform: 'uppercase',
    }}>
      {children}
    </div>
  )
}

function Btn({ children, onClick, variant = 'default', disabled, small }) {
  const styles = {
    default: { background: 'var(--bg-app)', color: 'var(--tx-1)', border: '1px solid var(--bd)' },
    primary: { background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none' },
    danger:  { background: 'transparent', color: 'var(--warn)', border: '1px solid var(--warn)' },
  }
  const s = styles[variant] || styles.default
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...s,
        padding: small ? '5px 10px' : '7px 14px',
        borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: "'DM Mono', monospace", fontSize: small ? 10 : 11,
        opacity: disabled ? 0.5 : 1, fontWeight: 600,
      }}
    >
      {children}
    </button>
  )
}

function Input({ value, onChange, placeholder, type = 'text', style }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      style={{
        background: 'var(--bg-app)', border: '1px solid var(--bd)',
        borderRadius: 6, padding: '6px 10px',
        fontFamily: "'DM Mono', monospace", fontSize: 12,
        color: 'var(--tx-1)', outline: 'none', width: '100%', ...style,
      }}
    />
  )
}

function Field({ label, children }) {
  return (
    <div>
      <MonoLabel style={{ marginBottom: 5 }}>{label}</MonoLabel>
      {children}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ cards, pointsBalances, monthlyForecast, runningBalance, coveragePct, optimizationPct, bills, onNavigate }) {
  const totalPts = Object.values(pointsBalances).reduce((s, b) => s + (b?.balance ?? 0), 0)
  const totalValue = estimateTotalValue(cards, pointsBalances)
  const monthlyRate = estimateMonthlyEarnRate(monthlyForecast)

  const now = new Date()
  const currentMonth = now.getMonth() + 1

  const eoyBalance = runningBalance.find(m => m.month === 12)?.total ?? 0

  if (cards.length === 0) {
    return (
      <div style={{
        border: '1px solid var(--bd)', borderRadius: 12, padding: 32,
        background: 'var(--bg-card)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>▬</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 8 }}>No cards configured yet</div>
        <div style={{ fontSize: 13, color: 'var(--tx-3)', marginBottom: 20 }}>
          Add your credit cards to start tracking points, forecasting earnings, and planning bill pay.
        </div>
        <Btn variant="primary" onClick={() => onNavigate('cards')}>Set Up Cards →</Btn>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatBox label="TOTAL POINTS" value={totalPts.toLocaleString()} sub="across all cards" accent />
        <StatBox label="EST. VALUE" value={fmtK(totalValue)} sub={`@ blended rate`} />
        <StatBox label="MONTHLY EARN RATE" value={monthlyRate.toLocaleString()} sub="avg pts/mo forecast" />
        <StatBox label="END OF YEAR BALANCE" value={eoyBalance.toLocaleString()} sub="after planned redemptions" />
      </div>

      {/* Cards grid */}
      <div>
        <SectionTitle>Cards</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {cards.map(card => {
            const bal = pointsBalances[card.id]?.balance ?? 0
            const cardValue = bal * (card.points_value_cents ?? 1.0) / 100
            const monthEarn = monthlyForecast.reduce((s, m) => s + (m.byCard[card.id] ?? 0), 0) / 12
            return (
              <div key={card.id} style={{
                border: `1px solid ${card.color || '#3B82F6'}44`,
                borderLeft: `3px solid ${card.color || '#3B82F6'}`,
                borderRadius: 10, background: 'var(--bg-card)', padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>{card.name}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-3)', marginTop: 2 }}>
                      {card.points_program || card.issuer || '—'} · {card.last_four ? `····${card.last_four}` : 'no last four'}
                    </div>
                  </div>
                  {card.is_default && (
                    <span style={{
                      fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.05em',
                      padding: '2px 6px', borderRadius: 4,
                      background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent-bd)',
                    }}>DEFAULT</span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <MonoLabel>POINTS</MonoLabel>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: 'var(--tx-1)', marginTop: 3 }}>
                      {bal.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <MonoLabel>EST. VALUE</MonoLabel>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: 'var(--accent)', marginTop: 3 }}>
                      {fmtK(cardValue)}
                    </div>
                  </div>
                  <div>
                    <MonoLabel>AVG EARN / MO</MonoLabel>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: 'var(--tx-2)', marginTop: 3 }}>
                      {Math.round(monthEarn).toLocaleString()} pts
                    </div>
                  </div>
                  <div>
                    <MonoLabel>¢ / POINT</MonoLabel>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: 'var(--tx-2)', marginTop: 3 }}>
                      {card.points_value_cents ?? 1.0}¢
                    </div>
                  </div>
                </div>
                {card.statement_close_day && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)' }}>
                      STATEMENT CLOSES {ordinal(card.statement_close_day)} · DUE {card.due_days_after_close || 21} DAYS LATER
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Optimization settings summary */}
      <div style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 18px', background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionTitle style={{ marginBottom: 0 }}>Optimization Settings</SectionTitle>
          <Btn small onClick={() => onNavigate('points')}>Adjust →</Btn>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <div>
            <MonoLabel>CARD COVERAGE</MonoLabel>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, color: 'var(--tx-1)', marginTop: 4 }}>{coveragePct}%</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-4)', marginTop: 2 }}>of expenses go on a card</div>
          </div>
          <div>
            <MonoLabel>ROUTING OPTIMIZATION</MonoLabel>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, color: 'var(--tx-1)', marginTop: 4 }}>{optimizationPct}%</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-4)', marginTop: 2 }}>routed to best card per category</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Points Forecast Tab ──────────────────────────────────────────────────────

function PointsTab({
  userId, cards, pointsBalances, monthlyForecast, runningBalance,
  coveragePct, optimizationPct, onCoveragePct, onOptimizationPct,
  redemptions, onRedemptionAdded, onRedemptionDeleted,
  year,
}) {
  const [newBal, setNewBal] = useState({})       // { cardId: value }
  const [newBalDate, setNewBalDate] = useState(new Date().toISOString().slice(0, 10))
  const [savingBal, setSavingBal] = useState(false)
  const [savingSliders, setSavingSliders] = useState(false)

  // Redemption form state
  const [redForm, setRedForm] = useState({ card_id: '', year, month: new Date().getMonth() + 1, points_amount: '', description: '' })
  const [addingRed, setAddingRed] = useState(false)

  async function saveSliders() {
    setSavingSliders(true)
    try {
      await updateCCSettings(userId, { coveragePct, optimizationPct })
    } finally {
      setSavingSliders(false)
    }
  }

  async function saveBalance(cardId) {
    const val = Number(newBal[cardId])
    if (!val && val !== 0) return
    setSavingBal(true)
    try {
      await upsertPointsBalance(userId, cardId, val, newBalDate)
      setNewBal(prev => ({ ...prev, [cardId]: '' }))
    } finally {
      setSavingBal(false)
    }
  }

  async function addRedemption() {
    if (!redForm.card_id || !redForm.points_amount) return
    setAddingRed(true)
    try {
      const saved = await upsertPointRedemption(userId, {
        card_id: redForm.card_id,
        year: Number(redForm.year),
        month: Number(redForm.month),
        points_amount: Number(redForm.points_amount),
        description: redForm.description || null,
      })
      onRedemptionAdded(saved)
      setRedForm(f => ({ ...f, points_amount: '', description: '' }))
    } finally {
      setAddingRed(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Point balance baselines */}
      <div>
        <SectionTitle>Current Point Balances</SectionTitle>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
          <div style={{ padding: '10px 16px', background: 'var(--bg-app)', borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <MonoLabel>Update baseline balance per card</MonoLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MonoLabel>AS OF</MonoLabel>
              <input
                type="date"
                value={newBalDate}
                onChange={e => setNewBalDate(e.target.value)}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 5, padding: '4px 8px', fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-2)', outline: 'none' }}
              />
            </div>
          </div>
          {cards.length === 0 ? (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--tx-3)' }}>Add cards first in the Cards tab.</div>
          ) : cards.map((card, i) => {
            const current = pointsBalances[card.id]?.balance ?? 0
            const asOf = pointsBalances[card.id]?.as_of_date
            return (
              <div key={card.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderBottom: i < cards.length - 1 ? '0.5px solid var(--bd-light)' : 'none',
              }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: card.color || '#3B82F6', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--tx-1)' }}>{card.name}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-3)' }}>
                    Current: {current.toLocaleString()} pts
                    {asOf ? ` · as of ${asOf}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    min="0"
                    value={newBal[card.id] ?? ''}
                    placeholder={current.toLocaleString()}
                    onChange={e => setNewBal(prev => ({ ...prev, [card.id]: e.target.value }))}
                    style={{
                      width: 110, background: 'var(--bg-app)', border: '1px solid var(--bd)',
                      borderRadius: 6, padding: '5px 8px',
                      fontFamily: "'DM Mono', monospace", fontSize: 12,
                      color: 'var(--tx-1)', outline: 'none', textAlign: 'right',
                    }}
                  />
                  <Btn small onClick={() => saveBalance(card.id)} disabled={!newBal[card.id] && newBal[card.id] !== 0 || savingBal}>
                    Save
                  </Btn>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Optimization sliders */}
      <div>
        <SectionTitle>Optimization Settings</SectionTitle>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: '18px 20px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Slider
            label="CARD COVERAGE — % OF EXPENSES GOING ON A CARD"
            value={coveragePct}
            onChange={onCoveragePct}
            hint="Expenses tagged 'cash only' (rent, taxes, ACH-only payments) are always excluded regardless of this setting."
          />
          <Slider
            label="ROUTING OPTIMIZATION — % GOING TO BEST CARD PER CATEGORY"
            value={optimizationPct}
            onChange={onOptimizationPct}
            hint={`0% = all spend on default card · 100% = always use the highest-earning card for each category`}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Btn variant="primary" onClick={saveSliders} disabled={savingSliders}>
              {savingSliders ? 'Saving…' : 'Save Settings'}
            </Btn>
          </div>
        </div>
      </div>

      {/* Monthly forecast table */}
      {cards.length > 0 && monthlyForecast.length > 0 && (
        <div>
          <SectionTitle>Points Earning Forecast — {year}</SectionTitle>
          <div style={{ overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--bg-card)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
              <thead>
                <tr style={{ background: 'var(--bg-app)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>MONTH</th>
                  {cards.map(c => (
                    <th key={c.id} style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                        <div style={{ width: 6, height: 6, borderRadius: 1, background: c.color || '#3B82F6' }} />
                        {c.name}
                      </div>
                    </th>
                  ))}
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>EARNED</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--warn)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>REDEEMED</th>
                  <th style={{ textAlign: 'right', padding: '10px 14px', color: 'var(--accent)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>BALANCE</th>
                </tr>
              </thead>
              <tbody>
                {monthlyForecast.map((mf, idx) => {
                  const bal = runningBalance[idx]
                  const monthRedemptions = redemptions.filter(r => r.month === mf.month)
                  const totalRedeemed = monthRedemptions.reduce((s, r) => s + r.points_amount, 0)
                  const isCurrentMonth = mf.month === new Date().getMonth() + 1
                  return (
                    <tr key={mf.month} style={{ borderBottom: '0.5px solid var(--bd-light)', background: isCurrentMonth ? 'var(--accent-bg)' : 'transparent' }}>
                      <td style={{ padding: '9px 14px', color: isCurrentMonth ? 'var(--accent)' : 'var(--tx-2)', fontWeight: isCurrentMonth ? 700 : 400 }}>
                        {MONTH_NAMES[mf.month - 1]}
                        {isCurrentMonth && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--accent)' }}>◉ NOW</span>}
                      </td>
                      {cards.map(c => (
                        <td key={c.id} style={{ textAlign: 'right', padding: '9px 12px', color: 'var(--tx-2)' }}>
                          {(mf.byCard[c.id] ?? 0).toLocaleString()}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', padding: '9px 12px', color: 'var(--tx-1)', fontWeight: 600 }}>
                        {mf.total.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', padding: '9px 12px', color: totalRedeemed > 0 ? 'var(--warn)' : 'var(--tx-4)' }}>
                        {totalRedeemed > 0 ? `(${totalRedeemed.toLocaleString()})` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '9px 14px', color: 'var(--accent)', fontWeight: 600 }}>
                        {(bal?.total ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Planned Redemptions */}
      <div>
        <SectionTitle>Planned Redemptions</SectionTitle>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
          {redemptions.length === 0 ? (
            <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--tx-3)' }}>
              No planned redemptions. Add one below to include it in the running balance forecast.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
              <thead>
                <tr style={{ background: 'var(--bg-app)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 14px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>CARD</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>MONTH</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>POINTS</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>DESCRIPTION</th>
                  <th style={{ padding: '8px 14px', borderBottom: '1px solid var(--bd)' }} />
                </tr>
              </thead>
              <tbody>
                {redemptions.map((r, i) => {
                  const card = cards.find(c => c.id === r.card_id)
                  return (
                    <tr key={r.id} style={{ borderBottom: '0.5px solid var(--bd-light)' }}>
                      <td style={{ padding: '8px 14px', color: 'var(--tx-1)' }}>
                        {card ? <CardChip card={card} /> : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)' }}>{MONTH_NAMES_FULL[r.month - 1]} {r.year}</td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--warn)', fontWeight: 600 }}>
                        ({r.points_amount.toLocaleString()})
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-3)' }}>{r.description || '—'}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                        <Btn small variant="danger" onClick={() => onRedemptionDeleted(r.id)}>✕</Btn>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* Add redemption form */}
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--bd)', background: 'var(--bg-app)' }}>
            <MonoLabel style={{ marginBottom: 10 }}>ADD PLANNED REDEMPTION</MonoLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ minWidth: 140 }}>
                <select
                  value={redForm.card_id}
                  onChange={e => setRedForm(f => ({ ...f, card_id: e.target.value }))}
                  style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 8px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-1)', outline: 'none' }}
                >
                  <option value="">Select card</option>
                  {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 90 }}>
                <select
                  value={redForm.month}
                  onChange={e => setRedForm(f => ({ ...f, month: Number(e.target.value) }))}
                  style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 8px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-1)', outline: 'none' }}
                >
                  {MONTH_NAMES_FULL.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 110 }}>
                <input
                  type="number"
                  min="1"
                  placeholder="Points"
                  value={redForm.points_amount}
                  onChange={e => setRedForm(f => ({ ...f, points_amount: e.target.value }))}
                  style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 8px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-1)', outline: 'none' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={redForm.description}
                  onChange={e => setRedForm(f => ({ ...f, description: e.target.value }))}
                  style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 8px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-1)', outline: 'none' }}
                />
              </div>
              <Btn variant="primary" onClick={addRedemption} disabled={addingRed || !redForm.card_id || !redForm.points_amount}>
                {addingRed ? '…' : '+ Add'}
              </Btn>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

// ─── Cards Setup Tab ──────────────────────────────────────────────────────────

const BLANK_CARD = {
  name: '', issuer: '', network: 'visa', last_four: '',
  points_program: '', is_default: false,
  statement_close_day: '', due_days_after_close: 21,
  annual_fee: '', annual_fee_month: '',
  points_value_cents: 1.0, color: '#3B82F6',
}

function CardForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || BLANK_CARD)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: '18px 20px', background: 'var(--bg-card)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        <Field label="CARD NAME *">
          <Input value={form.name} onChange={v => set('name', v)} placeholder="e.g. Sapphire Reserve" />
        </Field>
        <Field label="ISSUER">
          <Input value={form.issuer} onChange={v => set('issuer', v)} placeholder="e.g. Chase" />
        </Field>
        <Field label="NETWORK">
          <select
            value={form.network}
            onChange={e => set('network', e.target.value)}
            style={{ width: '100%', background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 10px', fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-1)', outline: 'none' }}
          >
            {NETWORKS.map(n => <option key={n} value={n}>{NETWORK_LABELS[n]}</option>)}
          </select>
        </Field>
        <Field label="LAST FOUR">
          <Input value={form.last_four} onChange={v => set('last_four', v.slice(0, 4))} placeholder="1234" />
        </Field>
        <Field label="POINTS PROGRAM">
          <Input value={form.points_program} onChange={v => set('points_program', v)} placeholder="e.g. Chase Ultimate Rewards" />
        </Field>
        <Field label="¢ PER POINT">
          <Input type="number" value={form.points_value_cents} onChange={v => set('points_value_cents', v)} placeholder="1.5" />
        </Field>
        <Field label="STATEMENT CLOSE DAY">
          <Input type="number" value={form.statement_close_day} onChange={v => set('statement_close_day', v)} placeholder="1–31" />
        </Field>
        <Field label="DUE DAYS AFTER CLOSE">
          <Input type="number" value={form.due_days_after_close} onChange={v => set('due_days_after_close', v)} placeholder="21" />
        </Field>
        <Field label="ANNUAL FEE ($)">
          <Input type="number" value={form.annual_fee} onChange={v => set('annual_fee', v)} placeholder="0" />
        </Field>
        <Field label="FEE MONTH">
          <select
            value={form.annual_fee_month || ''}
            onChange={e => set('annual_fee_month', e.target.value ? Number(e.target.value) : '')}
            style={{ width: '100%', background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 10px', fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-1)', outline: 'none' }}
          >
            <option value="">None</option>
            {MONTH_NAMES_FULL.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="CARD COLOR">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
            {CARD_COLORS.map(c => (
              <button
                key={c}
                onClick={() => set('color', c)}
                style={{
                  width: 22, height: 22, borderRadius: 5, background: c, border: 'none',
                  cursor: 'pointer', outline: form.color === c ? `2px solid var(--tx-1)` : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </Field>
        <Field label="OPTIONS">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6 }}>
            <input type="checkbox" checked={!!form.is_default} onChange={e => set('is_default', e.target.checked)} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-2)' }}>Default card (fallback for non-optimized spend)</span>
          </label>
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        {onCancel && <Btn onClick={onCancel}>Cancel</Btn>}
        <Btn variant="primary" onClick={() => onSave(form)} disabled={!form.name || saving}>
          {saving ? 'Saving…' : 'Save Card'}
        </Btn>
      </div>
    </div>
  )
}

function EarnRatesEditor({ card, earnRateMap, onSave }) {
  const rates = earnRateMap[card.id] ?? {}
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await Promise.all(
        CC_CATEGORIES.map(cat => {
          const val = edits[cat.slug] !== undefined ? edits[cat.slug] : (rates[cat.slug] ?? '')
          if (val === '' || val == null) return null
          return onSave(card.id, cat.slug, Number(val))
        }).filter(Boolean)
      )
      setEdits({})
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
        {CC_CATEGORIES.map(cat => {
          const currentRate = edits[cat.slug] !== undefined ? edits[cat.slug] : (rates[cat.slug] ?? '')
          return (
            <div key={cat.slug}>
              <MonoLabel style={{ marginBottom: 4 }}>{cat.label.toUpperCase()}</MonoLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={currentRate}
                  placeholder="1.0"
                  onChange={e => setEdits(prev => ({ ...prev, [cat.slug]: e.target.value }))}
                  style={{
                    flex: 1, background: 'var(--bg-app)', border: '1px solid var(--bd)',
                    borderRadius: 5, padding: '5px 8px',
                    fontFamily: "'DM Mono', monospace", fontSize: 11,
                    color: 'var(--tx-1)', outline: 'none', textAlign: 'right',
                  }}
                />
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)' }}>×</span>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <Btn small variant="primary" onClick={save} disabled={saving || Object.keys(edits).length === 0}>
          {saving ? 'Saving…' : 'Save Earn Rates'}
        </Btn>
      </div>
    </div>
  )
}

function CardsTab({ userId, cards, earnRateMap, budgetCategories, onCardsChanged, onEarnRateSaved }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [expandedEarnRates, setExpandedEarnRates] = useState({})
  const [expandedCatMap, setExpandedCatMap] = useState(false)
  const [catMapSaving, setCatMapSaving] = useState({})

  async function saveCard(form) {
    setSaving(true)
    try {
      await upsertCreditCard(userId, {
        ...form,
        statement_close_day: form.statement_close_day ? Number(form.statement_close_day) : null,
        due_days_after_close: Number(form.due_days_after_close) || 21,
        annual_fee: form.annual_fee ? Number(form.annual_fee) : null,
        annual_fee_month: form.annual_fee_month ? Number(form.annual_fee_month) : null,
        points_value_cents: Number(form.points_value_cents) || 1.0,
      })
      await onCardsChanged()
      setShowAdd(false)
      setEditId(null)
    } finally {
      setSaving(false)
    }
  }

  async function removeCard(id) {
    if (!confirm('Delete this card and all its earn rates and points history?')) return
    await deleteCreditCard(id)
    await onCardsChanged()
  }

  async function saveCatMapping(catId, ccCategory, cashOnly) {
    setCatMapSaving(prev => ({ ...prev, [catId]: true }))
    try {
      await supabase
        .from('budget_categories')
        .update({ cc_category: ccCategory || null, cash_only: cashOnly })
        .eq('id', catId)
    } finally {
      setCatMapSaving(prev => ({ ...prev, [catId]: false }))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Card list */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionTitle>Your Cards</SectionTitle>
          {!showAdd && <Btn small variant="primary" onClick={() => setShowAdd(true)}>+ Add Card</Btn>}
        </div>

        {showAdd && (
          <div style={{ marginBottom: 16 }}>
            <CardForm onSave={saveCard} onCancel={() => setShowAdd(false)} saving={saving} />
          </div>
        )}

        {cards.length === 0 && !showAdd ? (
          <div style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: '24px', background: 'var(--bg-card)', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
            No cards yet. Add your first card above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cards.map(card => (
              <div key={card.id} style={{
                border: `1px solid ${card.color || '#3B82F6'}44`,
                borderLeft: `3px solid ${card.color || '#3B82F6'}`,
                borderRadius: 10, background: 'var(--bg-card)', overflow: 'hidden',
              }}>
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {card.name}
                        {card.is_default && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent-bd)' }}>DEFAULT</span>}
                      </div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', marginTop: 2 }}>
                        {[card.points_program, card.last_four ? `····${card.last_four}` : null, card.statement_close_day ? `Closes ${ordinal(card.statement_close_day)}` : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn small onClick={() => setExpandedEarnRates(prev => ({ ...prev, [card.id]: !prev[card.id] }))}>
                      {expandedEarnRates[card.id] ? '▴ Earn Rates' : '▾ Earn Rates'}
                    </Btn>
                    <Btn small onClick={() => setEditId(editId === card.id ? null : card.id)}>Edit</Btn>
                    <Btn small variant="danger" onClick={() => removeCard(card.id)}>✕</Btn>
                  </div>
                </div>

                {editId === card.id && (
                  <div style={{ padding: '0 16px 16px' }}>
                    <CardForm initial={card} onSave={saveCard} onCancel={() => setEditId(null)} saving={saving} />
                  </div>
                )}

                {expandedEarnRates[card.id] && (
                  <div style={{ padding: '14px 16px', borderTop: '1px solid var(--bd)', background: 'var(--bg-app)' }}>
                    <MonoLabel style={{ marginBottom: 8 }}>EARN RATES (MULTIPLIER PER CATEGORY)</MonoLabel>
                    <EarnRatesEditor
                      card={card}
                      earnRateMap={earnRateMap}
                      onSave={(cardId, ccCat, rate) => onEarnRateSaved(userId, cardId, ccCat, rate)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Budget Category → CC Category mapping */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionTitle>Category Mapping</SectionTitle>
          <Btn small onClick={() => setExpandedCatMap(v => !v)}>
            {expandedCatMap ? '▴ Collapse' : '▾ Expand'}
          </Btn>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', marginBottom: 12 }}>
          Map each budget category to a credit card reward category so the points engine applies the right earn rate. Mark categories as "Cash Only" to exclude them from card coverage.
        </div>

        {expandedCatMap && (
          <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-card)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                <thead>
                  <tr style={{ background: 'var(--bg-app)' }}>
                    <th style={{ textAlign: 'left', padding: '9px 14px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>CATEGORY</th>
                    <th style={{ textAlign: 'left', padding: '9px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>GROUP</th>
                    <th style={{ textAlign: 'left', padding: '9px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>CC CATEGORY</th>
                    <th style={{ textAlign: 'center', padding: '9px 12px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)' }}>CASH ONLY</th>
                    <th style={{ padding: '9px 14px', borderBottom: '1px solid var(--bd)' }} />
                  </tr>
                </thead>
                <tbody>
                  {budgetCategories.filter(c => c.is_active).map((cat, i) => (
                    <CatMappingRow
                      key={cat.id}
                      cat={cat}
                      isLast={i === budgetCategories.filter(c => c.is_active).length - 1}
                      onSave={(ccCat, cashOnly) => saveCatMapping(cat.id, ccCat, cashOnly)}
                      saving={!!catMapSaving[cat.id]}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CatMappingRow({ cat, isLast, onSave, saving }) {
  const [ccCat, setCcCat] = useState(cat.cc_category || '')
  const [cashOnly, setCashOnly] = useState(!!cat.cash_only)
  const dirty = ccCat !== (cat.cc_category || '') || cashOnly !== !!cat.cash_only

  return (
    <tr style={{ borderBottom: isLast ? 'none' : '0.5px solid var(--bd-light)' }}>
      <td style={{ padding: '8px 14px', color: 'var(--tx-1)' }}>{cat.category}</td>
      <td style={{ padding: '8px 12px', color: 'var(--tx-3)' }}>{cat.group || '—'}</td>
      <td style={{ padding: '8px 12px' }}>
        <select
          value={ccCat}
          onChange={e => setCcCat(e.target.value)}
          style={{ background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 5, padding: '4px 8px', fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-1)', outline: 'none' }}
        >
          <option value="">— unassigned (other) —</option>
          {CC_CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
        </select>
      </td>
      <td style={{ textAlign: 'center', padding: '8px 12px' }}>
        <input type="checkbox" checked={cashOnly} onChange={e => setCashOnly(e.target.checked)} />
      </td>
      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
        {dirty && (
          <Btn small variant="primary" onClick={() => onSave(ccCat, cashOnly)} disabled={saving}>
            {saving ? '…' : 'Save'}
          </Btn>
        )}
      </td>
    </tr>
  )
}

// ─── Bill Pay Tab ─────────────────────────────────────────────────────────────

function BillPayTab({ cards, bills, year }) {
  const [viewMonth, setViewMonth] = useState(new Date().getMonth() + 1)

  const ccBills = bills.filter(b => b.bill_type === 'credit_card')

  function dueDateForMonth(card, month) {
    if (!card.statement_close_day) return null
    const closeDay = card.statement_close_day
    const dueDays = card.due_days_after_close || 21

    const closeDate = new Date(year, month - 1, closeDay)
    const dueDate = new Date(closeDate.getTime() + dueDays * 24 * 60 * 60 * 1000)
    return { closeDate, dueDate }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Month selector */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {MONTH_NAMES.map((m, i) => (
          <button
            key={i + 1}
            onClick={() => setViewMonth(i + 1)}
            style={{
              background: viewMonth === i + 1 ? 'var(--accent)' : 'var(--bg-card)',
              color: viewMonth === i + 1 ? 'var(--accent-tx-on)' : 'var(--tx-2)',
              border: `1px solid ${viewMonth === i + 1 ? 'var(--accent)' : 'var(--bd)'}`,
              borderRadius: 6, padding: '5px 10px',
              fontFamily: "'DM Mono', monospace", fontSize: 10,
              cursor: 'pointer', fontWeight: viewMonth === i + 1 ? 700 : 400,
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Month detail */}
      <div>
        <SectionTitle>Statement Cycle — {MONTH_NAMES_FULL[viewMonth - 1]} {year}</SectionTitle>
        {cards.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--tx-3)' }}>No cards configured. Add cards with statement close days to see the bill pay calendar.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cards.map(card => {
              const dates = dueDateForMonth(card, viewMonth)
              const fmtDate = d => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
              const linkedBill = ccBills.find(b => b.name === card.name)

              return (
                <div key={card.id} style={{
                  border: `1px solid ${card.color || '#3B82F6'}44`,
                  borderLeft: `3px solid ${card.color || '#3B82F6'}`,
                  borderRadius: 10, background: 'var(--bg-card)', padding: '14px 18px',
                  display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 2 }}>{card.name}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)' }}>
                      {card.points_program || card.issuer || '—'}
                    </div>
                  </div>

                  {dates ? (
                    <>
                      <div style={{ textAlign: 'center' }}>
                        <MonoLabel>STATEMENT CLOSES</MonoLabel>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-2)', marginTop: 4 }}>
                          {fmtDate(dates.closeDate)}
                        </div>
                      </div>
                      <div style={{ color: 'var(--tx-4)', fontSize: 14 }}>→</div>
                      <div style={{ textAlign: 'center' }}>
                        <MonoLabel>PAYMENT DUE</MonoLabel>
                        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--warn)', marginTop: 4 }}>
                          {fmtDate(dates.dueDate)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <MonoLabel>DAYS TO PAY</MonoLabel>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-2)', marginTop: 4 }}>
                          {card.due_days_after_close || 21}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-4)' }}>
                      No statement close day configured. Edit card to add billing cycle.
                    </div>
                  )}

                  <div style={{ textAlign: 'right', minWidth: 100 }}>
                    <MonoLabel>PAYMENT METHOD</MonoLabel>
                    <div style={{ marginTop: 4 }}>
                      {linkedBill ? (
                        <span style={{
                          fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.05em',
                          padding: '2px 7px', borderRadius: 4,
                          background: linkedBill.payment_method === 'auto' ? 'var(--accent-bg)' : 'var(--bg-app)',
                          color: linkedBill.payment_method === 'auto' ? 'var(--accent)' : 'var(--tx-3)',
                          border: `1px solid ${linkedBill.payment_method === 'auto' ? 'var(--accent-bd)' : 'var(--bd)'}`,
                        }}>
                          {linkedBill.payment_method === 'auto' ? 'AUTO PAY' : 'MANUAL'}
                        </span>
                      ) : (
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-4)' }}>
                          Link in Pay Periods
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Annual calendar */}
      <div>
        <SectionTitle>Annual Due Date Calendar</SectionTitle>
        <div style={{ overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--bg-card)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: "'DM Mono', monospace" }}>
            <thead>
              <tr style={{ background: 'var(--bg-app)' }}>
                <th style={{ textAlign: 'left', padding: '9px 14px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' }}>CARD</th>
                {MONTH_NAMES.map(m => (
                  <th key={m} style={{ textAlign: 'center', padding: '9px 8px', color: 'var(--tx-3)', fontWeight: 400, borderBottom: '1px solid var(--bd)', minWidth: 60 }}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.map((card, ci) => (
                <tr key={card.id} style={{ borderBottom: ci < cards.length - 1 ? '0.5px solid var(--bd-light)' : 'none' }}>
                  <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 1, background: card.color || '#3B82F6' }} />
                      <span style={{ color: 'var(--tx-1)' }}>{card.name}</span>
                    </div>
                  </td>
                  {MONTH_NAMES.map((_, mi) => {
                    const month = mi + 1
                    const dates = dueDateForMonth(card, month)
                    return (
                      <td key={month} style={{ textAlign: 'center', padding: '9px 8px', color: month === viewMonth ? 'var(--accent)' : 'var(--tx-2)' }}>
                        {dates ? dates.dueDate.getDate() : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-4)', marginTop: 6 }}>
          Numbers show payment due day for each month. Configure statement close day on each card to enable.
        </div>
      </div>

    </div>
  )
}

// ─── Main Module ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'points',   label: 'POINTS FORECAST' },
  { id: 'cards',    label: 'CARDS SETUP' },
  { id: 'billpay',  label: 'BILL PAY' },
]

export default function CreditCards({ userId, mobile }) {
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [cards, setCards] = useState([])
  const [earnRates, setEarnRates] = useState([])
  const [pointsBalances, setPointsBalances] = useState({})
  const [redemptions, setRedemptions] = useState([])
  const [coveragePct, setCoveragePct] = useState(80)
  const [optimizationPct, setOptimizationPct] = useState(100)
  const [budgetCategories, setBudgetCategories] = useState([])
  const [lineItems, setLineItems] = useState([])
  const [overrides, setOverrides] = useState([])
  const [bills, setBills] = useState([])

  const year = new Date().getFullYear()

  const earnRateMap = useMemo(() => buildEarnRateMap(earnRates), [earnRates])

  async function loadAll() {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const [
        cardsData, ratesData, balancesData, redemptionsData, settingsData,
        categoriesData, billsData,
      ] = await Promise.all([
        getCreditCards(userId),
        getEarnRates(userId),
        getPointsBalances(userId),
        getPointRedemptions(userId, year),
        getCCSettings(userId),
        getBudgetCategories(userId),
        supabase.from('bills').select('*').eq('user_id', userId).eq('active', true).then(r => r.data ?? []),
      ])

      const [lineItemsRes, overridesRes] = await Promise.all([
        supabase.from('budget_line_items').select('*').eq('user_id', userId).eq('budget_year', year).then(r => r.data ?? []),
        supabase.from('forecast_overrides').select('*').eq('user_id', userId).eq('budget_year', year).then(r => r.data ?? []),
      ])

      setCards(cardsData)
      setEarnRates(ratesData)
      setPointsBalances(balancesData)
      setRedemptions(redemptionsData)
      setCoveragePct(settingsData.coveragePct)
      setOptimizationPct(settingsData.optimizationPct)
      setBudgetCategories(categoriesData)
      setLineItems(lineItemsRes)
      setOverrides(overridesRes)
      setBills(billsData)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [userId])

  const reloadCards = useCallback(async () => {
    const [cardsData, ratesData] = await Promise.all([
      getCreditCards(userId),
      getEarnRates(userId),
    ])
    setCards(cardsData)
    setEarnRates(ratesData)
  }, [userId])

  const { monthlyForecast, runningBalance } = useMemo(() => {
    if (cards.length === 0) return { monthlyForecast: [], runningBalance: [] }
    return computePointsForecast({
      cards,
      earnRateMap,
      budgetCategories,
      lineItems,
      overrides,
      pointsBalances,
      redemptions,
      coveragePct,
      optimizationPct,
      year,
    })
  }, [cards, earnRateMap, budgetCategories, lineItems, overrides, pointsBalances, redemptions, coveragePct, optimizationPct, year])

  async function handleEarnRateSaved(userId, cardId, ccCat, rate) {
    await upsertEarnRate(userId, cardId, ccCat, rate)
    const ratesData = await getEarnRates(userId)
    setEarnRates(ratesData)
  }

  async function handleRedemptionAdded(saved) {
    setRedemptions(prev => [...prev.filter(r => r.id !== saved.id), saved].sort((a, b) => a.month - b.month))
  }

  async function handleRedemptionDeleted(id) {
    await deletePointRedemption(id)
    setRedemptions(prev => prev.filter(r => r.id !== id))
  }

  if (loading) {
    return (
      <div style={{ padding: mobile ? '20px 16px' : '32px 28px', maxWidth: 1100 }}>
        <ModuleHeader icon="▬" title="Credit Cards" />
        <div style={{ color: 'var(--tx-3)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>Loading…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: mobile ? '20px 16px' : '32px 28px', maxWidth: 1100 }}>
        <ModuleHeader icon="▬" title="Credit Cards" />
        <div style={{ color: 'var(--warn)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{error}</div>
      </div>
    )
  }

  return (
    <div style={{ padding: mobile ? '20px 16px' : '32px 28px', maxWidth: 1100 }}>
      <ModuleHeader
        icon="▬"
        title="Credit Cards"
        subtitle="Points tracking · spend optimization · bill pay timing"
        mobile={mobile}
      />

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <OverviewTab
          cards={cards}
          pointsBalances={pointsBalances}
          monthlyForecast={monthlyForecast}
          runningBalance={runningBalance}
          coveragePct={coveragePct}
          optimizationPct={optimizationPct}
          bills={bills}
          onNavigate={setTab}
        />
      )}

      {tab === 'points' && (
        <PointsTab
          userId={userId}
          cards={cards}
          pointsBalances={pointsBalances}
          monthlyForecast={monthlyForecast}
          runningBalance={runningBalance}
          coveragePct={coveragePct}
          optimizationPct={optimizationPct}
          onCoveragePct={setCoveragePct}
          onOptimizationPct={setOptimizationPct}
          redemptions={redemptions}
          onRedemptionAdded={handleRedemptionAdded}
          onRedemptionDeleted={handleRedemptionDeleted}
          year={year}
        />
      )}

      {tab === 'cards' && (
        <CardsTab
          userId={userId}
          cards={cards}
          earnRateMap={earnRateMap}
          budgetCategories={budgetCategories}
          onCardsChanged={reloadCards}
          onEarnRateSaved={handleEarnRateSaved}
        />
      )}

      {tab === 'billpay' && (
        <BillPayTab
          cards={cards}
          bills={bills}
          year={year}
        />
      )}
    </div>
  )
}
