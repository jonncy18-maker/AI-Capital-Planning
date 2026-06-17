import ModuleStub from '../common/ModuleStub.jsx'

export default function Commitments() {
  return (
    <ModuleStub
      icon="◈"
      eyebrow="// long-term commitments"
      title="Long-Term Commitments"
      phase="Phase 7"
      description="First-class tracking of every financial obligation spanning more than one year — scholarships, family support, leases, eldercare. Commitments feed automatically into Cash Flow Timing, the Budget Builder, and the Scenario Planner."
      features={[
        'Commitment records with cost structure and split rules',
        'Active / paused / completed list and detail timelines',
        'Auto-populate as future cash demands and Non-Monthly line items',
        'Surfaced as baseline constraints the AI reasons against',
      ]}
    />
  )
}
