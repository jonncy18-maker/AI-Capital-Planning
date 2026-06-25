// Shared utilities for the parser/classifier family of AI calls.
// billParser, creditCardParser, accountParser, billAmountsParser, and
// categoryMapper all follow the same structural pattern — this file
// eliminates the duplicate SYSTEM strings and sheetsToText function.

export function parserSystem(task, role = 'parser') {
  return `You are a financial data ${role}. Your only job is to ${task} and return valid JSON. No explanation, no markdown fences, no extra text — just the raw JSON array.`
}

export const JSON_ARRAY_RULE = 'Return ONLY a JSON array. No explanation. No markdown. No wrapper object. Start your response with [ and end with ].'

export function sheetsToText(sheets) {
  return sheets.map(sheet => {
    const nonEmpty = sheet.rows.filter(r => r.some(c => c !== '' && c != null))
    const lines = nonEmpty.map(r => r.join('\t'))
    return `=== Sheet: ${sheet.name} ===\n${lines.join('\n')}`
  }).join('\n\n')
}
