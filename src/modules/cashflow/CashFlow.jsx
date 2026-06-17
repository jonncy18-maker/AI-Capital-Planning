import ModuleStub from '../common/ModuleStub.jsx'

export default function CashFlow() {
  return (
    <ModuleStub
      icon="◷"
      eyebrow="// cash flow timing"
      title="Cash Flow Timing"
      phase="Phase 4"
      description="A month-by-month view of when money actually moves. Surfaces large and irregular expenses before they arrive, powered by your Non-Monthly commitment structure — no AI required to render."
      features={[
        '12-month rolling cash demand calendar',
        'Upcoming spike alerts with a configurable dollar threshold',
        'Quarter-by-quarter cash flow summary',
        'Category drill-down by month',
      ]}
    />
  )
}
