import ModuleStub from '../common/ModuleStub.jsx'

export default function Scenarios() {
  return (
    <ModuleStub
      icon="◑"
      eyebrow="// scenario planner"
      title="Scenario Planner"
      phase="Phase 5"
      description="The core decision engine — where you answer 'what happens if' questions. Model scenarios exploratorily, then promote the ones you commit to into your actual plan, with a full baseline audit trail."
      features={[
        'Create scenarios manually or via the AI command bar',
        'Modeled vs. Committed states with promote-to-committed flow',
        'View modes: baseline only, actual plan, or scenario vs. baseline',
        'Side-by-side scenario comparison and assumption sliders',
      ]}
    />
  )
}
