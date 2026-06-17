import { useState, useEffect } from 'react'
import { parseMonarchCSV, detectMonarchFormat } from '../../lib/csv/monarchParser.js'
import { findUnmappedCategories, applyMappings, ALL_GROUPS, GROUP_TYPE_DEFAULTS, getCategoryMapping } from '../../lib/csv/categoryMap.js'
import { importTransactions } from '../../lib/db/transactions.js'
import { seedDefaultCategories, upsertCategory } from '../../lib/db/budgetCategories.js'
import { logImport } from '../../lib/db/importLog.js'

// ── Screens ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: '36px',
      height: '36px',
      border: '3px solid var(--bd)',
      borderTop: '3px solid var(--accent)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
      margin: '0 auto',
    }} />
  )
}

// ── Parsing screen ─────────────────────────────────────────────────────────────

function ParseError({ errors, onRetry, onSkip }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: '24px' }}>
      <div style={{ fontSize: '32px', color: 'var(--warn)', lineHeight: 1 }}>⚠</div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '24px',
        color: 'var(--tx-1)',
        margin: '16px 0 8px',
        letterSpacing: '-0.01em',
      }}>
        CSV could not be parsed
      </div>
      <div style={{
        fontSize: '13px',
        color: 'var(--tx-2)',
        marginBottom: '20px',
        lineHeight: '1.6',
      }}>
        The file may not be in Monarch Money format, or the export is corrupted.
      </div>
      <div style={{
        border: '1px solid var(--bd)',
        borderRadius: '9px',
        background: 'var(--bg-card)',
        padding: '14px 16px',
        textAlign: 'left',
        marginBottom: '24px',
      }}>
        {errors.map((e, i) => (
          <div key={i} style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '11px',
            color: 'var(--warn)',
            marginBottom: i < errors.length - 1 ? '6px' : 0,
          }}>
            {e}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button onClick={onSkip} style={{
          border: '1px solid var(--ghost-bd)',
          background: 'none',
          color: 'var(--ghost-txt)',
          borderRadius: '8px',
          padding: '11px 20px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '13px',
          cursor: 'pointer',
        }}>
          Skip import
        </button>
        <button onClick={onRetry} style={{
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--accent-tx-on)',
          borderRadius: '8px',
          padding: '11px 20px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
        }}>
          Go back
        </button>
      </div>
    </div>
  )
}

// ── Unmapped categories screen ─────────────────────────────────────────────────

function UnmappedScreen({ unmapped, exampleRows, onConfirm, onSkipAll, mobile }) {
  const [mappings, setMappings] = useState(() => {
    const m = {}
    unmapped.forEach(cat => { m[cat] = { group: 'Uncategorized', type: 'Flexible', skip: false } })
    return m
  })

  function setGroup(cat, group) {
    setMappings(m => ({
      ...m,
      [cat]: { ...m[cat], group, type: GROUP_TYPE_DEFAULTS[group] ?? 'Flexible', skip: false },
    }))
  }

  function toggleSkip(cat) {
    setMappings(m => ({
      ...m,
      [cat]: { ...m[cat], skip: !m[cat].skip },
    }))
  }

  const exampleFor = cat => {
    const ex = exampleRows.filter(r => r.category === cat).slice(0, 2)
    return ex.map(r => r.merchant).join(', ')
  }

  return (
    <div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: 10,
        color: 'var(--accent)',
        letterSpacing: '0.1em',
        marginBottom: 6,
      }}>
        // unmapped categories
      </div>
      <h1 style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: mobile ? 24 : 30,
        fontWeight: 400,
        color: 'var(--tx-1)',
        margin: '0 0 8px',
        lineHeight: 1.1,
      }}>
        {unmapped.length} {unmapped.length === 1 ? 'category needs' : 'categories need'} mapping
      </h1>
      <div style={{
        fontSize: '13px',
        color: 'var(--tx-2)',
        marginBottom: '22px',
        lineHeight: '1.6',
      }}>
        These Monarch categories aren't in our default map. Assign each to a group, or skip to leave them uncategorized.
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        marginBottom: '16px',
        maxHeight: '55vh',
        overflowY: 'auto',
        paddingRight: '4px',
      }}>
        {unmapped.map(cat => {
          const m = mappings[cat]
          return (
            <div key={cat} style={{
              border: m.skip ? '1px solid var(--bd-light)' : '1px solid var(--bd)',
              borderRadius: '10px',
              padding: '14px 16px',
              background: m.skip ? 'transparent' : 'var(--bg-card)',
              opacity: m.skip ? 0.5 : 1,
              transition: 'opacity .15s',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '12px',
                marginBottom: m.skip ? 0 : '10px',
              }}>
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--tx-1)' }}>
                    {cat}
                  </div>
                  {exampleFor(cat) && (
                    <div style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: '10px',
                      color: 'var(--tx-3)',
                      marginTop: '3px',
                      letterSpacing: '0.02em',
                    }}>
                      e.g. {exampleFor(cat)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggleSkip(cat)}
                  style={{
                    flexShrink: 0,
                    border: '1px solid var(--bd)',
                    background: m.skip ? 'var(--bg-card)' : 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '9.5px',
                    color: m.skip ? 'var(--accent)' : 'var(--tx-3)',
                    cursor: 'pointer',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.skip ? 'UNDO SKIP' : 'SKIP'}
                </button>
              </div>

              {!m.skip && (
                <select
                  value={m.group}
                  onChange={e => setGroup(cat, e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--field)',
                    border: '1px solid var(--bd)',
                    borderRadius: '7px',
                    padding: '9px 10px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13px',
                    color: 'var(--tx-1)',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {ALL_GROUPS.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              )}
            </div>
          )
        })}
      </div>

      <div style={{
        borderTop: '1px solid var(--bd)',
        paddingTop: '16px',
        display: 'flex',
        gap: '12px',
        justifyContent: 'space-between',
      }}>
        <button onClick={onSkipAll} style={{
          border: '1px solid var(--ghost-bd)',
          background: 'none',
          color: 'var(--ghost-txt)',
          borderRadius: '8px',
          padding: '11px 18px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '13px',
          cursor: 'pointer',
        }}>
          Skip all unmapped
        </button>
        <button onClick={() => onConfirm(mappings)} style={{
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--accent-tx-on)',
          borderRadius: '8px',
          padding: '11px 22px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
        }}>
          Apply & import →
        </button>
      </div>
      <div style={{ marginBottom: '24px' }} />
    </div>
  )
}

// ── Importing screen ────────────────────────────────────────────────────────────

function ImportingScreen({ filename }) {
  return (
    <div style={{ textAlign: 'center', paddingTop: '48px' }}>
      <Spinner />
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '22px',
        color: 'var(--tx-1)',
        margin: '24px 0 8px',
        letterSpacing: '-0.01em',
      }}>
        Importing transactions…
      </div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '11px',
        color: 'var(--tx-3)',
        letterSpacing: '0.04em',
      }}>
        {filename ?? 'Processing CSV'}
      </div>
    </div>
  )
}

// ── Summary screen ─────────────────────────────────────────────────────────────

function SummaryScreen({ result, onDone }) {
  const { inserted, skipped, totalRows, filename, parseErrors, importError } = result

  return (
    <div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '10px',
        color: 'var(--accent)',
        letterSpacing: '0.1em',
        marginBottom: '10px',
      }}>
        // import complete
      </div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '26px',
        lineHeight: '1.25',
        color: 'var(--tx-1)',
        marginBottom: '22px',
        letterSpacing: '-0.01em',
      }}>
        {importError ? 'Import encountered an error' : 'Transactions imported'}
      </div>

      {importError ? (
        <div style={{
          border: '1px solid var(--warn)',
          borderRadius: '9px',
          background: 'var(--warn-bg)',
          padding: '16px',
          marginBottom: '20px',
        }}>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '11px',
            color: 'var(--warn)',
          }}>
            {importError}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <div style={{
            border: '1px solid var(--accent-bd)',
            borderRadius: '10px',
            background: 'var(--accent-bg)',
            padding: '18px',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: '32px',
              color: 'var(--accent)',
              lineHeight: 1,
            }}>
              {inserted.toLocaleString()}
            </div>
            <div style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '10px',
              color: 'var(--tx-3)',
              marginTop: '6px',
              letterSpacing: '0.06em',
            }}>
              ADDED
            </div>
          </div>
          <div style={{
            border: '1px solid var(--bd)',
            borderRadius: '10px',
            background: 'var(--bg-card)',
            padding: '18px',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: '32px',
              color: 'var(--tx-2)',
              lineHeight: 1,
            }}>
              {skipped.toLocaleString()}
            </div>
            <div style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '10px',
              color: 'var(--tx-3)',
              marginTop: '6px',
              letterSpacing: '0.06em',
            }}>
              DUPLICATES SKIPPED
            </div>
          </div>
        </div>
      )}

      {!importError && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1px',
          marginBottom: '22px',
        }}>
          <StatRow label="File" value={filename ?? '—'} />
          <StatRow label="Total rows in CSV" value={totalRows?.toLocaleString() ?? '—'} />
          <StatRow label="New transactions" value={inserted.toLocaleString()} accent />
          <StatRow label="Duplicates skipped" value={skipped.toLocaleString()} />
        </div>
      )}

      {parseErrors?.length > 0 && (
        <div style={{
          border: '1px solid var(--bd)',
          borderRadius: '9px',
          padding: '12px 14px',
          background: 'var(--bg-card)',
          marginBottom: '20px',
        }}>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '9.5px',
            color: 'var(--tx-3)',
            letterSpacing: '0.05em',
            marginBottom: '8px',
          }}>
            {parseErrors.length} ROW{parseErrors.length === 1 ? '' : 'S'} SKIPPED DURING PARSE
          </div>
          {parseErrors.slice(0, 5).map((e, i) => (
            <div key={i} style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '10px',
              color: 'var(--tx-3)',
              marginBottom: '3px',
            }}>
              {e}
            </div>
          ))}
          {parseErrors.length > 5 && (
            <div style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: '10px',
              color: 'var(--tx-3)',
            }}>
              …and {parseErrors.length - 5} more
            </div>
          )}
        </div>
      )}

      <button
        onClick={onDone}
        style={{
          width: '100%',
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--accent-tx-on)',
          borderRadius: '8px',
          padding: '13px',
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Go to dashboard →
      </button>
    </div>
  )
}

function StatRow({ label, value, accent }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '0.5px solid var(--bd-light)',
    }}>
      <span style={{ fontSize: '13px', color: 'var(--tx-2)' }}>{label}</span>
      <span style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '13px',
        color: accent ? 'var(--accent)' : 'var(--tx-1)',
        fontWeight: accent ? 500 : 400,
      }}>
        {value}
      </span>
    </div>
  )
}

// ── Main ImportFlow component ───────────────────────────────────────────────────

// Screens: 'parsing' | 'parse_error' | 'unmapped' | 'importing' | 'summary'
export default function ImportFlow({ csvRaw, csvName, userId, onComplete, mobile }) {
  const [screen, setScreen] = useState('parsing')
  const [parseResult, setParseResult] = useState(null)
  const [unmapped, setUnmapped] = useState([])
  const [importResult, setImportResult] = useState(null)

  // Auto-parse on mount
  useEffect(() => {
    if (!csvRaw) {
      // No CSV — skip straight to done
      onComplete(null)
      return
    }

    const result = parseMonarchCSV(csvRaw)
    setParseResult(result)

    if (result.errors.length > 0 && result.rows.length === 0) {
      setScreen('parse_error')
      return
    }

    const unmappedCats = findUnmappedCategories(result.rows)
    if (unmappedCats.length > 0) {
      setUnmapped(unmappedCats)
      setScreen('unmapped')
    } else {
      runImport(result.rows, result.errors, {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function runImport(rows, parseErrors, customMappings) {
    setScreen('importing')

    try {
      // Seed default categories for this user (idempotent)
      await seedDefaultCategories(userId)

      // Upsert any user-confirmed custom mappings
      for (const [cat, m] of Object.entries(customMappings)) {
        if (!m.skip) {
          await upsertCategory(userId, {
            category: cat,
            group: m.group,
            type: m.type,
          })
        }
      }

      // Apply all mappings to rows
      const mappedRows = applyMappings(rows, customMappings)

      // Import to Supabase
      const { inserted, skipped } = await importTransactions(userId, mappedRows)

      // Log the import
      const unmappedCount = Object.values(customMappings).filter(m => m.skip).length
      try {
        await logImport(userId, {
          filename: csvName,
          totalRows: rows.length,
          inserted,
          skipped,
          unmappedCount,
        })
      } catch {
        // Non-fatal — import succeeded even if logging fails
      }

      setImportResult({
        inserted,
        skipped,
        totalRows: rows.length,
        filename: csvName,
        parseErrors: parseErrors.length > 0 ? parseErrors : null,
      })
    } catch (err) {
      setImportResult({
        inserted: 0,
        skipped: 0,
        totalRows: rows?.length ?? 0,
        filename: csvName,
        importError: err.message,
      })
    }

    setScreen('summary')
  }

  function handleUnmappedConfirm(mappings) {
    runImport(parseResult.rows, parseResult.errors, mappings)
  }

  function handleSkipAllUnmapped() {
    const skipMappings = {}
    unmapped.forEach(cat => { skipMappings[cat] = { skip: true } })
    runImport(parseResult.rows, parseResult.errors, skipMappings)
  }

  return (
    <div style={{
      fontFamily: 'Inter, sans-serif',
      color: 'var(--tx-1)',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <div style={{ maxWidth: '520px' }}>

        {screen === 'parsing' && (
          <div style={{ textAlign: 'center', paddingTop: '48px' }}>
            <Spinner />
            <div style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: '22px',
              color: 'var(--tx-1)',
              margin: '24px 0 8px',
              letterSpacing: '-0.01em',
            }}>
              Reading your CSV…
            </div>
          </div>
        )}

        {screen === 'parse_error' && (
          <ParseError
            errors={parseResult?.errors ?? []}
            onRetry={onComplete}
            onSkip={() => onComplete(null)}
          />
        )}

        {screen === 'unmapped' && (
          <UnmappedScreen
            unmapped={unmapped}
            exampleRows={parseResult?.rows ?? []}
            onConfirm={handleUnmappedConfirm}
            onSkipAll={handleSkipAllUnmapped}
            mobile={mobile}
          />
        )}

        {screen === 'importing' && <ImportingScreen filename={csvName} />}

        {screen === 'summary' && (
          <SummaryScreen result={importResult} onDone={() => onComplete(importResult)} />
        )}
      </div>
    </div>
  )
}
