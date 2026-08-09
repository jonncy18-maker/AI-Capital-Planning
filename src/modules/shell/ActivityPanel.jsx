// Recent changes the assistant has made, newest first, with an Undo where the
// change has a well-defined inverse (a record it created can be deleted; an
// edit over existing values cannot be reconstructed and shows no button).

const GROUP_LABEL = {
  bills: 'Bills',
  budget: 'Budget',
  forecast: 'Forecast',
  income: 'Income',
  scenarios: 'Scenarios',
  commitments: 'Commitments',
  wealth: 'Wealth',
  accounts: 'Accounts',
  creditcards: 'Cards',
  settings: 'Settings',
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function ActivityPanel({ entries = [], busyId, onUndo, onClear }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid var(--bd)',
      }}>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '10px',
          letterSpacing: '0.08em',
          color: 'var(--tx-3)',
        }}>
          CHANGES MADE BY THE ASSISTANT
        </span>
        {entries.length > 0 && (
          <button
            onClick={onClear}
            style={{
              background: 'none',
              border: '1px solid var(--bd)',
              borderRadius: 7,
              padding: '3px 8px',
              fontFamily: "'DM Mono', monospace",
              fontSize: '9.5px',
              letterSpacing: '0.04em',
              color: 'var(--tx-3)',
              cursor: 'pointer',
            }}
          >
            CLEAR
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: entries.length ? '10px 14px' : 0 }}>
        {entries.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '28px 24px',
            textAlign: 'center',
            fontSize: '12.5px',
            lineHeight: 1.6,
            color: 'var(--tx-3)',
          }}>
            Nothing yet. Changes the assistant makes show up here so you can review or undo them.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(e => (
              <div
                key={e.id}
                style={{
                  border: '1px solid var(--bd)',
                  borderRadius: 9,
                  padding: '9px 11px',
                  opacity: e.undone ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '9.5px',
                    letterSpacing: '0.06em',
                    color: 'var(--accent)',
                  }}>
                    {(GROUP_LABEL[e.group] ?? e.group ?? '').toUpperCase()}
                  </span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '9.5px', color: 'var(--tx-3)' }}>
                    {timeAgo(e.at)}
                  </span>
                </div>

                <div style={{
                  fontSize: '12.5px',
                  color: 'var(--tx-1)',
                  lineHeight: 1.5,
                  marginTop: 3,
                  textDecoration: e.undone ? 'line-through' : 'none',
                }}>
                  {e.summary}
                </div>

                {e.undone ? (
                  <div style={{ fontSize: '11px', color: 'var(--tx-3)', marginTop: 4 }}>Undone</div>
                ) : e.undo ? (
                  <button
                    onClick={() => onUndo(e)}
                    disabled={busyId === e.id}
                    style={{
                      marginTop: 6,
                      background: 'transparent',
                      border: '1px solid var(--bd)',
                      borderRadius: 7,
                      padding: '4px 10px',
                      fontSize: '11px',
                      color: 'var(--tx-2)',
                      cursor: busyId === e.id ? 'default' : 'pointer',
                    }}
                  >
                    {busyId === e.id ? 'Undoing…' : '↩ Undo'}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
