// Minimal .docx (OOXML) reader — zero dependencies, mirrors the zip-reading
// approach in src/lib/xlsx/xlsxReader.js. Pulls plain text out of
// word/document.xml: paragraph runs become lines, tabs and manual line
// breaks map to their plain-text equivalents. Ignores styling, images,
// headers/footers, and tracked changes — callers only want the readable text.

const TEXT = new TextDecoder('utf-8')

function u16(b, o) {
  return b[o] | (b[o + 1] << 8)
}
function u32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

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
    if (u32(b, p) !== 0x02014b50) break
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
  const nameLen = u16(b, lh + 26)
  const extraLen = u16(b, lh + 28)
  const start = lh + 30 + nameLen + extraLen
  const data = b.subarray(start, start + entry.compSize)
  if (entry.method === 0) return data
  if (entry.method === 8) return await inflateRaw(data)
  throw new Error(`Unsupported zip compression in document (method ${entry.method}).`)
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

// Word marks a paragraph break with </w:p>, a manual line break with
// <w:br/>, and a tab with <w:tab/> — map each to its plain-text equivalent
// before stripping the remaining tags so the result keeps real line/word breaks.
function xmlToText(xml) {
  const body = (xml.match(/<w:body>([\s\S]*?)<\/w:body>/) || [])[1] ?? xml
  return body
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (_, t) => decodeEntities(t))
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Read a .docx ArrayBuffer into its plain document text.
export async function readDocx(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer)
  const eocd = findEOCD(b)
  if (eocd === -1) throw new Error('That file is not a valid Word document (no ZIP directory found).')

  const entries = readCentralDir(b, u32(b, eocd + 16), u16(b, eocd + 10))
  const entry = entries['word/document.xml']
  if (!entry) throw new Error('That file is not a valid Word document.')

  const xml = TEXT.decode(await readEntry(b, entry))
  return xmlToText(xml)
}
