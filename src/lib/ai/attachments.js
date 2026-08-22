// File upload support for the command bar — lets the user attach an image or
// PDF to a chat turn so Claude can read it directly (a bill, a screenshot, a
// statement). Ad-hoc and in-chat only; bulk transaction import stays on the
// dedicated CSV path in Settings.

export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']

// Vercel serverless functions cap the request body at 4.5MB (platform-fixed,
// not configurable). Base64 inflates the raw file by ~33%, so this needs
// real headroom below that ceiling once the system prompt, context brief,
// and tool schemas are added on top.
export const MAX_FILE_BYTES = 3 * 1024 * 1024

export function isSupportedFile(file) {
  return ALLOWED_FILE_TYPES.includes(file?.type)
}

// Reads a File into { name, size, mediaType, base64 } for attaching to a
// message. Rejects on read failure (corrupt file, permission denied, etc).
export function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] || ''
      resolve({ name: file.name, size: file.size, mediaType: file.type, base64 })
    }
    reader.readAsDataURL(file)
  })
}

// Builds the Anthropic message content blocks for a user turn carrying an
// attachment. PDFs use the `document` block type, everything else (the
// allowed image types) uses `image` — both take an inline base64 source.
export function buildUserContent(text, file) {
  const block = file.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: file.mediaType, data: file.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.base64 } }
  return [block, { type: 'text', text: text || 'What can you tell me about this file?' }]
}

export function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
