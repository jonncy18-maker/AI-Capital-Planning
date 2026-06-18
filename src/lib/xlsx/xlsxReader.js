// Minimal .xlsx (OOXML) reader — zero dependencies.
//
// An .xlsx file is a ZIP archive of XML parts. We locate the parts we need
// (workbook.xml, its relationships, sharedStrings.xml, and each worksheet),
// inflate them with the platform DecompressionStream, and pull cell values
// into a simple 2-D grid per sheet. We ignore styles, formulas, and number
// formatting — callers only want the text content laid out by row/column.
//
// Supported zip compression: stored (0) and deflate (8) — the only two Excel
// and Google Sheets emit. Anything else throws a clear error.

const TEXT = new TextDecoder('utf-8')

function u16(b, o) {
  return b[o] | (b[o + 1] << 8)
}
function u32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

// Scan backwards for the End Of Central Directory record signature (PK\x05\x06).
function findEOCD(b) {
  const min = Math.max(0, b.length - 22 - 0xffff)
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      return i
    }
  }
  return -1
}

function readCentralDir(b, offset, count) {
  const entries = {}
  let p = offset
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break // central directory file header
    const method = u16(b, p + 10)
    const compSize = u32(b, p + 20)
    const nameLen = u16(b, p + 28)
    const extraLen = u16(b, p + 30)
    const commentLen = u16(b, p + 32)
    const localOffset = u32(b, p + 42)
    const name = TEXT.decode(b.subarray(p + 46, p + 46 + nameLen))
    entries[name] = { method, compSize, localOffset }
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Response(bytes).body.pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

async function readEntry(b, entry) {
  const lh = entry.localOffset
  // Local file header: name/extra lengths can differ from the central record.
  const nameLen = u16(b, lh + 26)
  const extraLen = u16(b, lh + 28)
  const start = lh + 30 + nameLen + extraLen
  const data = b.subarray(start, start + entry.compSize)
  if (entry.method === 0) return data
  if (entry.method === 8) return await inflateRaw(data)
  throw new Error(`Unsupported zip compression in workbook (method ${entry.method}).`)
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// Concatenate every <t> run inside an XML fragment (shared string or inline str).
function extractText(frag) {
  let s = ''
  const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let m
  while ((m = tRe.exec(frag))) s += decodeEntities(m[1])
  return s
}

function parseSharedStrings(xml) {
  const out = []
  const siRe = /<si>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRe.exec(xml))) out.push(extractText(m[1]))
  return out
}

// 'A' -> 0, 'B' -> 1, 'Z' -> 25, 'AA' -> 26, ...
function colToIndex(letters) {
  let n = 0
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64)
  return n - 1
}

function valueFromCell(attrs, inner, shared) {
  const type = (attrs.match(/\bt="([^"]+)"/) || [])[1]
  if (type === 'inlineStr') return extractText(inner)
  const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
  if (v == null) return ''
  if (type === 's') return shared[parseInt(v, 10)] ?? '' // shared-string index
  return decodeEntities(v) // number / boolean / 'str' formula result
}

function parseSheet(xml, shared) {
  const rows = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(xml))) {
    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1]
      const inner = cm[2] || ''
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1]
      const col = ref ? colToIndex(ref) : cells.length
      cells[col] = valueFromCell(attrs, inner, shared)
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = ''
    rows.push(cells)
  }
  return rows
}

// Read an .xlsx ArrayBuffer into { sheets: [{ name, rows: string[][] }] },
// in the workbook's declared sheet order.
export async function readXlsx(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer)
  const eocd = findEOCD(b)
  if (eocd === -1) throw new Error('That file is not a valid Excel workbook (no ZIP directory found).')

  const entries = readCentralDir(b, u32(b, eocd + 16), u16(b, eocd + 10))
  const decode = async name =>
    entries[name] ? TEXT.decode(await readEntry(b, entries[name])) : null

  const wbXml = await decode('xl/workbook.xml')
  if (!wbXml) throw new Error('That file is not a valid Excel workbook.')

  const relsXml = await decode('xl/_rels/workbook.xml.rels')
  const ssXml = await decode('xl/sharedStrings.xml')
  const shared = ssXml ? parseSharedStrings(ssXml) : []

  const relMap = {}
  if (relsXml) {
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const id = (m[0].match(/\bId="([^"]+)"/) || [])[1]
      const target = (m[0].match(/\bTarget="([^"]+)"/) || [])[1]
      if (id && target) relMap[id] = target
    }
  }

  const sheets = []
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = m[0]
    const name = decodeEntities((tag.match(/\bname="([^"]*)"/) || [])[1] || '')
    const rid = (tag.match(/r:id="([^"]+)"/) || [])[1]
    let target = relMap[rid]
    if (!target) continue
    target = target.replace(/^\//, '') // absolute part path
    if (!target.startsWith('xl/')) target = 'xl/' + target // rels are relative to xl/
    const xml = await decode(target)
    if (!xml) continue
    sheets.push({ name, rows: parseSheet(xml, shared) })
  }

  return { sheets }
}
