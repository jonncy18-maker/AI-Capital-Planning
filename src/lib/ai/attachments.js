// File upload support for the command bar — lets the user attach a file to a
// chat turn so Claude can read it directly (a bill photo, a screenshot, a
// statement, a budget spreadsheet, a Word doc). Ad-hoc and in-chat only; bulk
// transaction import stays on the dedicated CSV path in Settings.

import { readXlsx } from '../xlsx/xlsxReader.js'
import { readDocx } from '../docx/docxReader.js'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const PDF_TYPE = 'application/pdf'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// The `accept` attribute for the file picker. Extensions are listed alongside
// MIME types because browsers report an empty/generic type for .md (and
// sometimes .docx/.xlsx on older OS file-type registrations).
export const ACCEPT_ATTR = [
  'image/*', PDF_TYPE, 'text/plain', 'text/markdown', XLSX_TYPE, DOCX_TYPE,
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.txt', '.md', '.xlsx', '.docx',
].join(',')

// Vercel serverless functions cap the request body at 4.5MB (platform-fixed,
// not configurable). Base64 inflates the raw file by ~33%, so this needs
// real headroom below that ceiling once the system prompt, context brief,
// and tool schemas are added on top.
export const MAX_FILE_BYTES = 3 * 1024 * 1024

// Extracted text (from .txt/.md/.xlsx/.docx) is inlined as a plain-text
// document block rather than base64, so the request-body ceiling above isn't
// the binding constraint — the model's context window and per-call cost are.
// This keeps a single attachment to a sane slice of that budget.
const MAX_TEXT_CHARS = 100_000

export const UNSUPPORTED_FILE_MESSAGE =
  'Only images (JPG, PNG, WEBP, GIF), PDFs, Word/Excel files (.docx, .xlsx), and text/Markdown (.txt, .md) are supported.'

function extOf(name) {
  const m = /\.[^.]+$/.exec(name || '')
  return m ? m[0].toLowerCase() : ''
}

// 'image' | 'pdf' | 'xlsx' | 'docx' | 'text' | null. Extension is checked
// first for the ambiguous kinds (.md especially rarely gets a real MIME type
// from the OS), falling back to the browser-reported type otherwise.
export function fileKind(file) {
  const ext = extOf(file?.name)
  if (ext === '.pdf' || file?.type === PDF_TYPE) return 'pdf'
  if (ext === '.xlsx' || file?.type === XLSX_TYPE) return 'xlsx'
  if (ext === '.docx' || file?.type === DOCX_TYPE) return 'docx'
  if (ext === '.txt' || ext === '.md') return 'text'
  if (IMAGE_TYPES.includes(file?.type)) return 'image'
  return null
}

export function isSupportedFile(file) {
  return fileKind(file) != null
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(file)
  })
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => resolve(reader.result)
    reader.readAsArrayBuffer(file)
  })
}

function truncate(text) {
  if (text.length <= MAX_TEXT_CHARS) return text
  return text.slice(0, MAX_TEXT_CHARS) + '\n\n[…truncated — file is longer than fits here]'
}

function xlsxToText(sheets) {
  return sheets
    .map(({ name, rows }) => `### Sheet: ${name}\n` + rows.map(r => r.join(' | ')).join('\n'))
    .join('\n\n')
}

// Reads a File into an attachment ready for buildUserContent():
// images/PDFs keep their bytes as base64; everything else is resolved to
// plain text client-side (a spreadsheet becomes a row/column text table, a
// Word doc becomes its paragraph text) since Claude's native document
// understanding only covers images and PDFs.
export async function readFileAsAttachment(file) {
  const kind = fileKind(file)
  if (!kind) throw new Error(UNSUPPORTED_FILE_MESSAGE)

  if (kind === 'image' || kind === 'pdf') {
    const base64 = await readAsDataURL(file)
    const mediaType = kind === 'pdf' ? PDF_TYPE : file.type
    return { name: file.name, size: file.size, kind, mediaType, base64 }
  }

  if (kind === 'text') {
    const text = truncate(await readAsText(file))
    return { name: file.name, size: file.size, kind, text }
  }

  if (kind === 'xlsx') {
    const { sheets } = await readXlsx(await readAsArrayBuffer(file))
    return { name: file.name, size: file.size, kind, text: truncate(xlsxToText(sheets)) }
  }

  // kind === 'docx'
  const text = await readDocx(await readAsArrayBuffer(file))
  return { name: file.name, size: file.size, kind, text: truncate(text) }
}

// Builds the Anthropic message content blocks for a user turn carrying an
// attachment. Images/PDFs use inline base64 source blocks; everything else
// (already resolved to plain text) uses a text-source document block so the
// model sees it labeled as a document rather than loose prompt text.
export function buildUserContent(text, file) {
  let block
  if (file.kind === 'image') {
    block = { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.base64 } }
  } else if (file.kind === 'pdf') {
    block = { type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data: file.base64 } }
  } else {
    block = { type: 'document', source: { type: 'text', media_type: 'text/plain', data: file.text }, title: file.name }
  }
  return [block, { type: 'text', text: text || 'What can you tell me about this file?' }]
}

export function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
