import ModuleStub from '../common/ModuleStub.jsx'

export default function Wealth() {
  return (
    <ModuleStub
      icon="↗"
      eyebrow="// wealth trajectory"
      title="Wealth Trajectory"
      phase="Phase 8"
      description="Long-term wealth and retirement scenario modeling. Answers 'where is my overall financial life heading?' based on your assumptions — it does not manage investments or provide licensed advice."
      features={[
        'Net worth baseline and snapshot history',
        'Contribution and market-return scenario sliders',
        'Commitment impact overlay on the trajectory',
        'Bonus allocation and retirement horizon modeling',
      ]}
    />
  )
}
