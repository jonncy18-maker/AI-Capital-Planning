// Parse a transaction/commitment date as a LOCAL calendar date.
// `new Date('2026-09-01')` is UTC midnight, which getMonth()/getFullYear()
// read back as Aug 31 in any timezone west of UTC. The API may also send DATE
// columns as '2026-09-01T00:00:00.000Z'; both forms carry the intended calendar
// day in their first 10 characters, so build the Date from those parts.
export function parseLocalDate(val) {
  if (val instanceof Date) return val
  const m = typeof val === 'string' ? val.match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(val)
}
