// Pieces shared by the MCP-only tool files. Browser-safe like every tool file:
// no SQL, no node: imports, only db seams.

export const MODE_PROP = {
  type: 'string',
  enum: ['preview', 'commit'],
  description: 'preview (default) shows what would change and saves nothing; commit saves.',
}

// Property bag plus `mode`, for a write tool's input_schema.
export function withMode(properties) {
  return { ...properties, mode: MODE_PROP }
}
