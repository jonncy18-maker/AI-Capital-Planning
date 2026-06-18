// Tiny, dependency-free Markdown renderer for assistant answers — enough to make
// responses read cleanly instead of as a raw text blob: headings, bold, italic,
// inline code, and bullet / numbered lists. Builds React nodes directly (no
// dangerouslySetInnerHTML), so there's no injection surface.

import { Fragment } from 'react'

// Inline: **bold**, *italic*, `code`. Returns an array of React nodes.
function renderInline(text, keyPrefix = 'i') {
  const tokens = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  let last = 0
  let m
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index))
    if (m[2] != null) {
      tokens.push(<strong key={`${keyPrefix}-${i}`} style={{ color: 'var(--tx-1)', fontWeight: 600 }}>{m[2]}</strong>)
    } else if (m[3] != null) {
      tokens.push(
        <code key={`${keyPrefix}-${i}`} style={{
          fontFamily: "'DM Mono', monospace", fontSize: '0.92em',
          background: 'var(--field)', border: '1px solid var(--bd-light)',
          borderRadius: 4, padding: '1px 5px',
        }}>{m[3]}</code>
      )
    } else if (m[4] != null) {
      tokens.push(<em key={`${keyPrefix}-${i}`}>{m[4]}</em>)
    }
    last = m.index + m[0].length
    i += 1
  }
  if (last < text.length) tokens.push(text.slice(last))
  return tokens
}

export default function Markdown({ text, style }) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let list = null // { ordered, items: [] }

  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={`l-${blocks.length}`} style={{ margin: '6px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {list.items.map((it, i) => (
          <li key={i} style={{ lineHeight: 1.55 }}>{renderInline(it, `l${blocks.length}-${i}`)}</li>
        ))}
      </Tag>
    )
    list = null
  }

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
    const heading = line.match(/^(#{1,3})\s+(.*)$/)

    if (bullet) {
      if (!list || list.ordered) flushList()
      list = list || { ordered: false, items: [] }
      list.items.push(bullet[1])
      return
    }
    if (numbered) {
      if (!list || !list.ordered) flushList()
      list = list || { ordered: true, items: [] }
      list.items.push(numbered[1])
      return
    }
    flushList()
    if (heading) {
      const level = heading[1].length
      blocks.push(
        <div key={`h-${idx}`} style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: level === 1 ? 18 : level === 2 ? 15.5 : 14,
          color: 'var(--tx-1)', margin: '10px 0 4px', lineHeight: 1.25,
        }}>{renderInline(heading[2], `h${idx}`)}</div>
      )
    } else if (line.trim() === '') {
      blocks.push(<div key={`s-${idx}`} style={{ height: 6 }} />)
    } else {
      blocks.push(<p key={`p-${idx}`} style={{ margin: '4px 0', lineHeight: 1.65 }}>{renderInline(line, `p${idx}`)}</p>)
    }
  })
  flushList()

  return <div style={{ fontSize: 13.5, color: 'var(--tx-1)', ...style }}>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
