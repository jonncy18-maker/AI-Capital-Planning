// Shared module-header type ramp. Kept in its own module (not the component
// file) so both <ModuleHeader> and the few modules that hand-roll their header
// (e.g. Scenarios' sticky full-height layout) render titles/subtitles in the
// exact same fonts.

export const headerStyles = {
  icon: { fontSize: 20, color: 'var(--accent)', lineHeight: 1, flexShrink: 0 },
  title: (mobile) => ({
    fontFamily: "'DM Serif Display', serif",
    fontSize: mobile ? 22 : 26,
    fontWeight: 400,
    color: 'var(--tx-1)',
    margin: 0,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
  }),
  subtitle: { fontSize: 13.5, color: 'var(--tx-2)', lineHeight: 1.5 },
}
