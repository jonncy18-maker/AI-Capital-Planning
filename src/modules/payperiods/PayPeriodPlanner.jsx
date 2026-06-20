import { useState, useEffect, useCallback, useRef } from 'react'
import ModuleHeader from '../common/ModuleHeader.jsx'
import {
  getAccounts, upsertAccount, deleteAccount,
  getBills, upsertBill, deleteBill,
  getBillAmounts, upsertBillAmount,
  getAccountBalances, upsertAccountBalance,
  splitBillsByPeriod,
} from '../../lib/db/bills.js'
import { getProfile } from '../../lib/db/profile.js'
import { parseBillsFromFile } from '../../lib/ai/billParser.js'

// ─── Constants ───────────────────────────────────────────────────────────────

const BILL_TYPES = [
  { id: 'credit_card',  label: 'Credit Card' },
  { id: 'loan',         label: 'Loan' },
  { id: 'rent',         label: 'Rent / Mortgage' },
  { id: 'investment',   label: 'Investment' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'other',        label: 'Other' },
]

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

const BILL_TYPE_LABELS = Object.fromEntries(BILL_TYPES.map(t => [t.id, t.label]))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = n =>
  n == null ? '—' : '$' + Math.abs(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 0 })

const fmtSigned = n =>
  n == null ? '—' : (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(Number(n))).toLocaleString()

function ordinal(n) {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function buildAmountsMap(billAmounts) {
  return Object.fromEntries(billAmounts.map(b => [b.bill_id, b.amount]))
}

function buildBalancesMap(accountBalances) {
  // key: `${accountId}-${periodHalf}`
  return Object.fromEntries(accountBalances.map(b => [`${b.account_id}-${b.period_half}`, b.balance]))
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 28, borderBottom: '1px solid var(--bd)' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 14px', marginBottom: -1,
            fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: '0.05em',
            color: active === t.id ? 'var(--tx-1)' : 'var(--tx-3)',
            borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'color 0.15s',
          }}
        >
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

function Badge({ label, variant = 'neutral' }) {
  const colors = {
    auto:    { bg: 'var(--accent-bg)', color: 'var(--accent)', border: 'var(--accent-bd)' },
    manual:  { bg: 'var(--bg-app)',    color: 'var(--tx-3)',   border: 'var(--bd)' },
    warn:    { bg: 'var(--warn-bg)',   color: 'var(--warn)',   border: 'var(--warn)' },
    neutral: { bg: 'var(--bg-app)',    color: 'var(--tx-3)',   border: 'var(--bd)' },
  }
  const c = colors[variant] || colors.neutral
  return (
    <span style={{
      fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.05em',
      padding: '2px 7px', borderRadius: 4,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {label}
    </span>
  )
}

// ─── Period Card ──────────────────────────────────────────────────────────────

function PeriodCard({ period, label, payDay, bills, amountsMap, primaryChecking, balancesMap, onAmountChange, onBalanceChange, mobile }) {
  const total = bills.reduce((sum, b) => {
    const amt = amountsMap[b.id] ?? b.fixed_amount
    return sum + (amt ? Number(amt) : 0)
  }, 0)

  const balanceKey = primaryChecking ? `${primaryChecking.id}-${period}` : null
  const checkingBalance = balanceKey ? (balancesMap[balanceKey] ?? '') : ''
  const transferNeeded = checkingBalance !== '' ? Math.max(0, total - Number(checkingBalance)) : null

  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 12,
      background: 'var(--bg-card)', overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{
        padding: '14px 18px 12px',
        borderBottom: '1px solid var(--bd)',
        background: 'var(--bg-app)',
      }}>
        <MonoLabel>{label}</MonoLabel>
        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--tx-2)' }}>
          Bills due on or before the <strong style={{ color: 'var(--tx-1)' }}>{ordinal(payDay)}</strong>
        </div>
      </div>

      {/* Bill rows */}
      <div style={{ padding: '0 18px' }}>
        {bills.length === 0 ? (
          <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--tx-3)', textAlign: 'center' }}>
            No bills in this period
          </div>
        ) : (
          bills.map(bill => {
            const isVariable = bill.fixed_amount == null
            const amount = amountsMap[bill.id] ?? (bill.fixed_amount != null ? bill.fixed_amount : null)
            return (
              <div
                key={bill.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 0', borderBottom: '0.5px solid var(--bd-light)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 500, marginBottom: 2 }}>
                    {bill.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MonoLabel style={{ fontSize: 9 }}>{ordinal(bill.pay_day)}</MonoLabel>
                    <Badge label={bill.payment_method === 'auto' ? 'AUTO' : 'MANUAL'} variant={bill.payment_method === 'auto' ? 'auto' : 'manual'} />
                  </div>
                </div>
                {isVariable ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-3)' }}>$</span>
                    <input
                      type="number"
                      min="0"
                      value={amount ?? ''}
                      placeholder="0"
                      onChange={e => onAmountChange(bill.id, e.target.value)}
                      style={{
                        width: 90, background: 'var(--bg-app)', border: '1px solid var(--bd)',
                        borderRadius: 6, padding: '5px 8px',
                        fontFamily: "'DM Mono', monospace", fontSize: 12,
                        color: 'var(--tx-1)', outline: 'none', textAlign: 'right',
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: 'var(--tx-1)' }}>
                    {fmt(amount)}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Period summary */}
      <div style={{ padding: '14px 18px', background: 'var(--bg-app)', borderTop: '1px solid var(--bd)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <MonoLabel>TOTAL DUE</MonoLabel>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--tx-1)' }}>
            {fmt(total)}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <MonoLabel style={{ whiteSpace: 'nowrap' }}>CHECKING BAL.</MonoLabel>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-3)' }}>$</span>
            <input
              type="number"
              min="0"
              value={checkingBalance}
              placeholder="0"
              onChange={e => onBalanceChange(period, e.target.value)}
              disabled={!primaryChecking}
              title={!primaryChecking ? 'Add a checking account in the Accounts tab to save balances' : ''}
              style={{
                flex: 1, background: 'var(--bg-card)', border: '1px solid var(--bd)',
                borderRadius: 6, padding: '5px 8px',
                fontFamily: "'DM Mono', monospace", fontSize: 12,
                color: primaryChecking ? 'var(--tx-1)' : 'var(--tx-3)',
                outline: 'none', textAlign: 'right',
                opacity: primaryChecking ? 1 : 0.5,
              }}
            />
          </div>
        </div>

        {transferNeeded !== null && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 10px', borderRadius: 7,
            background: transferNeeded > 0 ? 'var(--warn-bg)' : 'var(--accent-bg)',
            border: `1px solid ${transferNeeded > 0 ? 'var(--warn)' : 'var(--accent-bd)'}`,
            marginTop: 4,
          }}>
            <MonoLabel style={{ color: transferNeeded > 0 ? 'var(--warn)' : 'var(--accent)', fontSize: 9 }}>
              {transferNeeded > 0 ? 'TRANSFER NEEDED' : '✓ COVERED'}
            </MonoLabel>
            <div style={{
              fontFamily: "'DM Serif Display', serif", fontSize: 15,
              color: transferNeeded > 0 ? 'var(--warn)' : 'var(--accent)',
            }}>
              {transferNeeded > 0 ? fmt(transferNeeded) : fmt(Number(checkingBalance) - total)}
            </div>
          </div>
        )}

        {!primaryChecking && (
          <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 6 }}>
            Add a checking account in the Accounts tab to track balances.
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bill Form ────────────────────────────────────────────────────────────────

const EMPTY_BILL = {
  name: '', bill_type: 'credit_card', due_day: '', pay_same_as_due: true, pay_day: '',
  payment_method: 'manual', fixed_amount: null, debits_from_account_id: null,
}

function BillForm({ initial, accounts, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(initial || EMPTY_BILL)
  const [isFixed, setIsFixed] = useState(initial ? initial.fixed_amount != null : false)
  const [fixedInput, setFixedInput] = useState(initial?.fixed_amount != null ? String(initial.fixed_amount) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const showLateWarning = !form.pay_same_as_due &&
    form.pay_day && form.due_day &&
    Number(form.pay_day) > Number(form.due_day)

  async function handleSave() {
    if (!form.name.trim()) return setErr('Name is required.')
    if (!form.due_day) return setErr('Due day is required.')
    const payDay = form.pay_same_as_due ? form.due_day : form.pay_day
    if (!payDay) return setErr('Pay day is required.')
    setSaving(true)
    setErr(null)
    try {
      await onSave({
        ...form,
        due_day: Number(form.due_day),
        pay_day: Number(payDay),
        fixed_amount: isFixed && fixedInput ? Number(fixedInput) : null,
      })
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--bg-app)', border: '1px solid var(--bd)',
    borderRadius: 7, padding: '9px 11px',
    color: 'var(--tx-1)', fontSize: 13, outline: 'none',
    fontFamily: 'Inter, sans-serif',
  }

  const labelStyle = {
    fontFamily: "'DM Mono', monospace", fontSize: 9.5,
    color: 'var(--tx-3)', letterSpacing: '0.06em', marginBottom: 5, display: 'block',
  }

  const fieldGap = { marginBottom: 14 }

  return (
    <div style={{
      border: '1px solid var(--accent-bd)', borderRadius: 10,
      padding: '18px 16px', background: 'var(--bg-card)', marginBottom: 12,
    }}>
      {/* Name */}
      <div style={fieldGap}>
        <label style={labelStyle}>BILL NAME</label>
        <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Chase Sapphire" />
      </div>

      {/* Type */}
      <div style={fieldGap}>
        <label style={labelStyle}>TYPE</label>
        <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.bill_type} onChange={e => set('bill_type', e.target.value)}>
          {BILL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      {/* Payment method */}
      <div style={fieldGap}>
        <label style={labelStyle}>PAYMENT METHOD</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {['auto', 'manual'].map(m => (
            <button
              key={m}
              onClick={() => set('payment_method', m)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 7, cursor: 'pointer', fontSize: 12,
                fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em',
                background: form.payment_method === m ? 'var(--accent)' : 'var(--bg-app)',
                color: form.payment_method === m ? 'var(--accent-tx-on)' : 'var(--tx-2)',
                border: form.payment_method === m ? '1px solid var(--accent)' : '1px solid var(--bd)',
              }}
            >
              {m === 'auto' ? 'AUTO' : 'MANUAL'}
            </button>
          ))}
        </div>
      </div>

      {/* Due day */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, ...fieldGap }}>
        <div>
          <label style={labelStyle}>DUE DAY OF MONTH</label>
          <input
            style={inputStyle} type="number" min="1" max="31"
            value={form.due_day} onChange={e => set('due_day', e.target.value)}
            placeholder="1–31"
          />
        </div>
        <div>
          <label style={labelStyle}>PAY DAY</label>
          <input
            style={{ ...inputStyle, opacity: form.pay_same_as_due ? 0.4 : 1 }}
            type="number" min="1" max="31"
            value={form.pay_same_as_due ? form.due_day : form.pay_day}
            disabled={form.pay_same_as_due}
            onChange={e => set('pay_day', e.target.value)}
            placeholder="1–31"
          />
        </div>
      </div>

      {/* Same day checkbox */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -6, ...fieldGap }}>
        <input
          id="pay-same" type="checkbox" checked={form.pay_same_as_due}
          onChange={e => set('pay_same_as_due', e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
        />
        <label htmlFor="pay-same" style={{ fontSize: 12, color: 'var(--tx-2)', cursor: 'pointer' }}>
          Pay date same as due date
        </label>
      </div>

      {/* Late payment warning */}
      {showLateWarning && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'var(--warn-bg)', border: '1px solid var(--warn)',
          borderRadius: 7, padding: '9px 12px', marginBottom: 14,
        }}>
          <span style={{ color: 'var(--warn)', fontSize: 14, marginTop: 1 }}>⚠</span>
          <span style={{ fontSize: 12, color: 'var(--warn)', lineHeight: 1.5 }}>
            Pay date is set after due date — late fees may apply.
          </span>
        </div>
      )}

      {/* Amount */}
      <div style={fieldGap}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input
            id="fixed-amt" type="checkbox" checked={isFixed}
            onChange={e => setIsFixed(e.target.checked)}
            style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
          />
          <label htmlFor="fixed-amt" style={{ fontSize: 12, color: 'var(--tx-2)', cursor: 'pointer' }}>
            Fixed monthly amount
          </label>
        </div>
        {isFixed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: 'var(--tx-3)' }}>$</span>
            <input
              style={inputStyle} type="number" min="0"
              value={fixedInput} onChange={e => setFixedInput(e.target.value)}
              placeholder="0"
            />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>
            Variable — you'll enter the amount each month in the Schedule view.
          </div>
        )}
      </div>

      {/* Debits from account */}
      {accounts.length > 0 && (
        <div style={fieldGap}>
          <label style={labelStyle}>DEBITS FROM</label>
          <select
            style={{ ...inputStyle, cursor: 'pointer' }}
            value={form.debits_from_account_id || ''}
            onChange={e => set('debits_from_account_id', e.target.value || null)}
          >
            <option value="">— Select account —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {err && <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={handleSave} disabled={saving}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Bill'}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '9px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
            background: 'none', color: 'var(--tx-2)', border: '1px solid var(--bd)',
          }}
        >
          Cancel
        </button>
        {initial?.id && (
          <button
            onClick={() => onDelete(initial.id)}
            style={{
              padding: '9px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
              background: 'none', color: 'var(--warn)', border: '1px solid var(--warn)',
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Account Form ─────────────────────────────────────────────────────────────

const EMPTY_ACCOUNT = { name: '', type: 'checking', is_primary_checking: false }

function AccountForm({ initial, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(initial || EMPTY_ACCOUNT)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) return setErr('Name is required.')
    setSaving(true)
    setErr(null)
    try {
      await onSave(form)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--bg-app)', border: '1px solid var(--bd)',
    borderRadius: 7, padding: '9px 11px',
    color: 'var(--tx-1)', fontSize: 13, outline: 'none',
  }
  const labelStyle = {
    fontFamily: "'DM Mono', monospace", fontSize: 9.5,
    color: 'var(--tx-3)', letterSpacing: '0.06em', marginBottom: 5, display: 'block',
  }

  return (
    <div style={{
      border: '1px solid var(--accent-bd)', borderRadius: 10,
      padding: '16px', background: 'var(--bg-card)', marginBottom: 10,
    }}>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>ACCOUNT NAME</label>
        <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. SoFi Checking" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>TYPE</label>
        <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.type} onChange={e => set('type', e.target.value)}>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="investment">Investment</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <input
          id="primary-chk" type="checkbox" checked={form.is_primary_checking}
          onChange={e => set('is_primary_checking', e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
        />
        <label htmlFor="primary-chk" style={{ fontSize: 12, color: 'var(--tx-2)', cursor: 'pointer' }}>
          Primary checking account (used for transfer calculations)
        </label>
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 10 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleSave} disabled={saving}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Account'}
        </button>
        <button onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 12, background: 'none', color: 'var(--tx-2)', border: '1px solid var(--bd)' }}>
          Cancel
        </button>
        {initial?.id && (
          <button onClick={() => onDelete(initial.id)} style={{ padding: '8px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12, background: 'none', color: 'var(--warn)', border: '1px solid var(--warn)' }}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

<<<<<<< HEAD
// ─── Parse Review Panel ───────────────────────────────────────────────────────

function ParseReviewPanel({ selections, onToggle, onNameEdit, onImport, onDismiss, importing }) {
  const selectedCount = selections.filter(s => s.selected).length

  return (
    <div style={{ border: '1px solid var(--accent-bd)', borderRadius: 10, background: 'var(--bg-card)', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg-app)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>
            AI detected {selections.length} recurring bill{selections.length !== 1 ? 's' : ''}
          </div>
          <MonoLabel style={{ marginTop: 4 }}>Review and select which to import</MonoLabel>
        </div>
        <button
          onClick={onDismiss}
          style={{
            flexShrink: 0, background: 'none', border: '1px solid var(--bd)', cursor: 'pointer',
            color: 'var(--tx-2)', fontFamily: "'DM Mono', monospace", fontSize: 10,
            letterSpacing: '0.04em', borderRadius: 7, padding: '5px 10px',
          }}
        >
          Dismiss
        </button>
      </div>

      <div style={{ padding: '0 16px' }}>
        {selections.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
            No recurring bills detected. Try a different file.
          </div>
        ) : (
          selections.map((sel, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '0.5px solid var(--bd-light)',
                opacity: sel.selected ? 1 : 0.45,
              }}
            >
              <input
                type="checkbox"
                checked={sel.selected}
                onChange={() => onToggle(i)}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  value={sel.editedName}
                  onChange={e => onNameEdit(i, e.target.value)}
                  style={{
                    width: '100%', background: 'transparent', border: 'none', outline: 'none',
                    fontSize: 13, color: 'var(--tx-1)', fontWeight: 500,
                    fontFamily: 'Inter, sans-serif',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                  <MonoLabel style={{ fontSize: 9 }}>{BILL_TYPE_LABELS[sel.bill_type] || sel.bill_type}</MonoLabel>
                  <MonoLabel style={{ fontSize: 9 }}>·</MonoLabel>
                  <MonoLabel style={{ fontSize: 9 }}>Due {ordinal(sel.due_day)}</MonoLabel>
                  {sel.pay_day !== sel.due_day && (
                    <><MonoLabel style={{ fontSize: 9 }}>·</MonoLabel><MonoLabel style={{ fontSize: 9 }}>Pay {ordinal(sel.pay_day)}</MonoLabel></>
                  )}
                </div>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge
                  label={sel.payment_method === 'auto' ? 'AUTO' : 'MANUAL'}
                  variant={sel.payment_method === 'auto' ? 'auto' : 'manual'}
                />
                {sel.fixed_amount != null ? (
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 14, color: 'var(--tx-1)', minWidth: 60, textAlign: 'right' }}>
                    {fmt(sel.fixed_amount)}
                  </div>
                ) : (
                  <MonoLabel style={{ fontSize: 9, fontStyle: 'italic', minWidth: 48, textAlign: 'right' }}>Variable</MonoLabel>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 8 }}>
        <button
          onClick={onImport}
          disabled={selectedCount === 0 || importing}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 7, fontSize: 12, fontWeight: 600,
            cursor: selectedCount === 0 || importing ? 'not-allowed' : 'pointer',
            background: selectedCount === 0 ? 'var(--bg-app)' : 'var(--accent)',
            color: selectedCount === 0 ? 'var(--tx-3)' : 'var(--accent-tx-on)',
            border: selectedCount === 0 ? '1px solid var(--bd)' : 'none',
            opacity: importing ? 0.6 : 1,
          }}
        >
          {importing ? 'Importing…' : `Import ${selectedCount} Bill${selectedCount !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: '9px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
            background: 'none', color: 'var(--tx-2)', border: '1px solid var(--bd)',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

=======
>>>>>>> origin/main
// ─── Main Module ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'schedule', label: 'SCHEDULE' },
  { id: 'bills',    label: 'BILLS' },
  { id: 'accounts', label: 'ACCOUNTS' },
]

export default function PayPeriodPlanner({ userId, mobile }) {
  const now = new Date()
  const [tab, setTab] = useState('schedule')
  const [navYear, setNavYear] = useState(now.getFullYear())
  const [navMonth, setNavMonth] = useState(now.getMonth() + 1)

  const [profile, setProfile] = useState(null)
  const [bills, setBills] = useState([])
  const [accounts, setAccounts] = useState([])
  const [amountsMap, setAmountsMap] = useState({})    // billId → amount (for current navMonth)
  const [balancesMap, setBalancesMap] = useState({})  // `accountId-periodHalf` → balance
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Editing state
  const [editingBill, setEditingBill] = useState(null)   // bill object or 'new'
  const [editingAccount, setEditingAccount] = useState(null)

<<<<<<< HEAD
  // File upload + AI parse state
  const fileInputRef = useRef(null)
  const [parsedSelections, setParsedSelections] = useState(null) // null = inactive
  const [parseLoading, setParseLoading] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [importingParsed, setImportingParsed] = useState(false)

=======
>>>>>>> origin/main
  // ── Load data ───────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    if (!userId) return
    try {
      const [prof, fetchedBills, fetchedAccounts] = await Promise.all([
        getProfile(userId),
        getBills(userId),
        getAccounts(userId),
      ])
      setProfile(prof)
      setBills(fetchedBills)
      setAccounts(fetchedAccounts)
    } catch (e) {
      setError(e.message)
    }
  }, [userId])

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))
  }, [reload])

  // Reload amounts + balances when nav month changes
  useEffect(() => {
    if (!userId) return
    Promise.all([
      getBillAmounts(userId, navYear, navMonth),
      getAccountBalances(userId, navYear, navMonth),
    ]).then(([amounts, balances]) => {
      setAmountsMap(buildAmountsMap(amounts))
      setBalancesMap(buildBalancesMap(balances))
    }).catch(() => {})
  }, [userId, navYear, navMonth])

  // ── Derived values ──────────────────────────────────────────────────────────

  const payDay1 = profile?.pay_day_1 ?? 15
  const payDay2 = profile?.pay_day_2 ?? 30
  const hasPaySchedule = profile?.pay_frequency != null

  // Split bills: period 1 = pay_day < pay_day_2, period 2 = pay_day >= pay_day_2
  const { period1, period2 } = splitBillsByPeriod(bills, amountsMap, payDay2 - 1)

  const primaryChecking = accounts.find(a => a.is_primary_checking && a.type === 'checking') ?? null

  // ── Month navigation ────────────────────────────────────────────────────────

  function prevMonth() {
    if (navMonth === 1) { setNavYear(y => y - 1); setNavMonth(12) }
    else setNavMonth(m => m - 1)
  }

  function nextMonth() {
    if (navMonth === 12) { setNavYear(y => y + 1); setNavMonth(1) }
    else setNavMonth(m => m + 1)
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleAmountChange(billId, rawValue) {
    const value = rawValue === '' ? null : Number(rawValue)
    setAmountsMap(prev => ({ ...prev, [billId]: value }))
    if (!userId) return
    try {
      if (value == null) return
      await upsertBillAmount(userId, billId, navYear, navMonth, value)
    } catch (e) {
      console.error('Failed to save bill amount:', e)
    }
  }

  async function handleBalanceChange(periodHalf, rawValue) {
    if (!primaryChecking) return
    const value = rawValue === '' ? '' : rawValue
    const key = `${primaryChecking.id}-${periodHalf}`
    setBalancesMap(prev => ({ ...prev, [key]: value }))
    if (value === '' || isNaN(Number(value))) return
    try {
      await upsertAccountBalance(userId, primaryChecking.id, navYear, navMonth, periodHalf, Number(value))
    } catch (e) {
      console.error('Failed to save balance:', e)
    }
  }

  async function handleSaveBill(formData) {
    await upsertBill(userId, formData)
    setEditingBill(null)
    await reload()
  }

  async function handleDeleteBill(id) {
    await deleteBill(id)
    setEditingBill(null)
    await reload()
  }

  async function handleSaveAccount(formData) {
    await upsertAccount(userId, formData)
    setEditingAccount(null)
    await reload()
  }

  async function handleDeleteAccount(id) {
    await deleteAccount(id)
    setEditingAccount(null)
    await reload()
  }

<<<<<<< HEAD
  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setParseLoading(true)
    setParseError(null)
    setParsedSelections(null)
    try {
      const results = await parseBillsFromFile(file)
      setParsedSelections(results.map(b => ({ ...b, selected: true, editedName: b.name })))
    } catch (err) {
      setParseError(err.message)
    } finally {
      setParseLoading(false)
    }
  }

  async function handleImportParsed() {
    if (!parsedSelections) return
    setImportingParsed(true)
    setParseError(null)
    try {
      const toImport = parsedSelections.filter(s => s.selected)
      for (const sel of toImport) {
        await upsertBill(userId, { ...sel, name: sel.editedName })
      }
      setParsedSelections(null)
      await reload()
    } catch (e) {
      setParseError(e.message)
    } finally {
      setImportingParsed(false)
    }
  }

=======
>>>>>>> origin/main
  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 20, background: 'var(--warn-bg)', borderRadius: 10, color: 'var(--warn)', fontSize: 13 }}>
        {error}
      </div>
    )
  }

  return (
    <div>
      <ModuleHeader
        icon="◫"
        title="Pay Period Planner"
        subtitle="Track bills by pay period and know exactly how much to transfer before each one hits."
        mobile={mobile}
      />

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {/* ── Schedule Tab ── */}
      {tab === 'schedule' && (
        <div>
          {!hasPaySchedule && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: 'var(--warn-bg)', border: '1px solid var(--warn)',
              borderRadius: 9, padding: '12px 14px', marginBottom: 20,
            }}>
              <span style={{ color: 'var(--warn)', fontSize: 14, marginTop: 1 }}>⚠</span>
              <div style={{ fontSize: 13, color: 'var(--warn)', lineHeight: 1.5 }}>
                No pay schedule configured. Go to <strong>Settings → Income &amp; Goals</strong> to set your pay frequency and pay dates.
              </div>
            </div>
          )}

          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', color: 'var(--tx-2)', fontSize: 14 }}>‹</button>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--tx-1)', minWidth: 140, textAlign: 'center' }}>
              {MONTH_NAMES[navMonth - 1]} {navYear}
            </div>
            <button onClick={nextMonth} style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', color: 'var(--tx-2)', fontSize: 14 }}>›</button>
          </div>

          {bills.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
              No bills added yet.{' '}
              <button onClick={() => setTab('bills')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
                Add your first bill →
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              <PeriodCard
                period={1}
                label={`PERIOD 1 · AROUND THE ${ordinal(payDay1).toUpperCase()}`}
                payDay={payDay2 - 1}
                bills={period1}
                amountsMap={amountsMap}
                primaryChecking={primaryChecking}
                balancesMap={balancesMap}
                onAmountChange={handleAmountChange}
                onBalanceChange={handleBalanceChange}
                mobile={mobile}
              />
              <PeriodCard
                period={2}
                label={`PERIOD 2 · AROUND THE ${ordinal(payDay2).toUpperCase()}`}
                payDay={31}
                bills={period2}
                amountsMap={amountsMap}
                primaryChecking={primaryChecking}
                balancesMap={balancesMap}
                onAmountChange={handleAmountChange}
                onBalanceChange={handleBalanceChange}
                mobile={mobile}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Bills Tab ── */}
      {tab === 'bills' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <MonoLabel>ALL BILLS ({bills.length})</MonoLabel>
<<<<<<< HEAD
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={parseLoading}
                style={{
                  background: 'none', border: '1px solid var(--bd)', borderRadius: 7,
                  padding: '7px 14px', cursor: parseLoading ? 'not-allowed' : 'pointer',
                  fontSize: 12, color: 'var(--tx-2)',
                  opacity: parseLoading ? 0.6 : 1,
                }}
              >
                {parseLoading ? 'Parsing…' : '↑ Upload File'}
              </button>
              <button
                onClick={() => setEditingBill('new')}
                style={{
                  background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
                  borderRadius: 7, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}
              >
                + Add Bill
              </button>
            </div>
          </div>

          {parseLoading && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 16px', borderRadius: 9, marginBottom: 16,
              border: '1px solid var(--accent-bd)', background: 'var(--accent-bg)',
            }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
              <div style={{ fontSize: 13, color: 'var(--accent)' }}>Reading file and extracting bills with AI…</div>
            </div>
          )}

          {parseError && (
            <div style={{
              padding: '12px 14px', borderRadius: 9, marginBottom: 16,
              border: '1px solid var(--warn)', background: 'var(--warn-bg)',
              fontSize: 13, color: 'var(--warn)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10,
            }}>
              <span>{parseError}</span>
              <button onClick={() => setParseError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warn)', fontSize: 14, flexShrink: 0, lineHeight: 1 }}>✕</button>
            </div>
          )}

          {parsedSelections !== null && (
            <ParseReviewPanel
              selections={parsedSelections}
              onToggle={i => setParsedSelections(prev => prev.map((s, idx) => idx === i ? { ...s, selected: !s.selected } : s))}
              onNameEdit={(i, name) => setParsedSelections(prev => prev.map((s, idx) => idx === i ? { ...s, editedName: name } : s))}
              onImport={handleImportParsed}
              onDismiss={() => { setParsedSelections(null); setParseError(null) }}
              importing={importingParsed}
            />
          )}

=======
            <button
              onClick={() => setEditingBill('new')}
              style={{
                background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
                borderRadius: 7, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              + Add Bill
            </button>
          </div>

>>>>>>> origin/main
          {editingBill === 'new' && (
            <BillForm
              accounts={accounts}
              onSave={handleSaveBill}
              onCancel={() => setEditingBill(null)}
              onDelete={handleDeleteBill}
            />
          )}

          {bills.length === 0 && editingBill !== 'new' && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
              No bills yet. Click <strong>+ Add Bill</strong> to get started.
            </div>
          )}

          {bills.map(bill => {
            const isEditing = editingBill?.id === bill.id
            const accountName = accounts.find(a => a.id === bill.debits_from_account_id)?.name
            return (
              <div key={bill.id}>
                {isEditing ? (
                  <BillForm
                    initial={bill}
                    accounts={accounts}
                    onSave={handleSaveBill}
                    onCancel={() => setEditingBill(null)}
                    onDelete={handleDeleteBill}
                  />
                ) : (
                  <div
                    onClick={() => setEditingBill(bill)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', marginBottom: 6,
                      border: '1px solid var(--bd)', borderRadius: 9,
                      background: 'var(--bg-card)', cursor: 'pointer',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-bd)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bd)'}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 500 }}>{bill.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        <MonoLabel style={{ fontSize: 9 }}>{BILL_TYPE_LABELS[bill.bill_type]}</MonoLabel>
                        <MonoLabel style={{ fontSize: 9 }}>·</MonoLabel>
                        <MonoLabel style={{ fontSize: 9 }}>Due {ordinal(bill.due_day)}</MonoLabel>
                        {bill.pay_day !== bill.due_day && (
                          <><MonoLabel style={{ fontSize: 9 }}>·</MonoLabel><MonoLabel style={{ fontSize: 9 }}>Pay {ordinal(bill.pay_day)}</MonoLabel></>
                        )}
                        {accountName && (
                          <><MonoLabel style={{ fontSize: 9 }}>·</MonoLabel><MonoLabel style={{ fontSize: 9 }}>{accountName}</MonoLabel></>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <Badge label={bill.payment_method === 'auto' ? 'AUTO' : 'MANUAL'} variant={bill.payment_method === 'auto' ? 'auto' : 'manual'} />
                      {bill.fixed_amount != null ? (
                        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 14, color: 'var(--tx-1)' }}>
                          {fmt(bill.fixed_amount)}
                        </div>
                      ) : (
                        <MonoLabel style={{ fontSize: 9, fontStyle: 'italic' }}>Variable</MonoLabel>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Accounts Tab ── */}
      {tab === 'accounts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <MonoLabel>ACCOUNTS ({accounts.length})</MonoLabel>
            <button
              onClick={() => setEditingAccount('new')}
              style={{
                background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
                borderRadius: 7, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              + Add Account
            </button>
          </div>

          {editingAccount === 'new' && (
            <AccountForm
              onSave={handleSaveAccount}
              onCancel={() => setEditingAccount(null)}
              onDelete={handleDeleteAccount}
            />
          )}

          {accounts.length === 0 && editingAccount !== 'new' && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
              No accounts yet. Add your checking and savings accounts to enable transfer calculations.
            </div>
          )}

          {accounts.map(account => {
            const isEditing = editingAccount?.id === account.id
            return (
              <div key={account.id}>
                {isEditing ? (
                  <AccountForm
                    initial={account}
                    onSave={handleSaveAccount}
                    onCancel={() => setEditingAccount(null)}
                    onDelete={handleDeleteAccount}
                  />
                ) : (
                  <div
                    onClick={() => setEditingAccount(account)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', marginBottom: 6,
                      border: '1px solid var(--bd)', borderRadius: 9,
                      background: 'var(--bg-card)', cursor: 'pointer',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-bd)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bd)'}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 500 }}>{account.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <MonoLabel style={{ fontSize: 9, textTransform: 'capitalize' }}>{account.type}</MonoLabel>
                        {account.is_primary_checking && (
                          <><MonoLabel style={{ fontSize: 9 }}>·</MonoLabel><MonoLabel style={{ fontSize: 9, color: 'var(--accent)' }}>PRIMARY CHECKING</MonoLabel></>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
