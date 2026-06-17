import ModuleStub from '../common/ModuleStub.jsx'

export default function Budget() {
  return (
    <ModuleStub
      icon="▦"
      eyebrow="// annual budget builder"
      title="Annual Budget Builder"
      phase="Phase 6"
      description="Replaces the manual spreadsheet process. An AI-guided session that reads 12–24 months of transaction history, identifies your Fixed / Flexible / Non-Monthly patterns, and generates a full multi-year, month-by-month budget schedule."
      features={[
        'Historical pattern analyzer across imported transactions',
        'Conversational timing confirmation for Non-Monthly items',
        'Month-by-month schedule generator with annual drill-down',
        'Multi-year view with Long-Term Commitments auto-populated',
      ]}
    />
  )
}
