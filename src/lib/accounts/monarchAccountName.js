// Validation for accounts.monarch_account_name (the exact Monarch account text
// used to match transactions to an app account).

export const MONARCH_NAME_MAX = 120

export function normalizeMonarchAccountName(v) {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'monarch_account_name must be a string or null.' }
  const s = v.trim()
  if (s === '') return { ok: true, value: null }
  if (s.length > MONARCH_NAME_MAX) {
    return { ok: false, error: `monarch_account_name must be at most ${MONARCH_NAME_MAX} characters.` }
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(s)) {
    return { ok: false, error: 'monarch_account_name must not contain control characters.' }
  }
  return { ok: true, value: s }
}
