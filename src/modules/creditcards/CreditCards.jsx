import ModuleStub from '../common/ModuleStub.jsx'

export default function CreditCards() {
  return (
    <ModuleStub
      icon="▬"
      title="Credit Cards"
      description="Manage your credit cards in one place — track statement balances and due dates, plan payments around your pay cycle, optimize rewards and point redemptions, and stay on top of churning opportunities."
      phase="coming soon"
      features={[
        'Bill calendar showing each card\'s due date, statement balance, and auto vs. manual payment status',
        'Transfer planner — calculates exactly how much to move from savings to checking before each pay period',
        'Rewards & points tracker across cards and programs',
        'Churning pipeline — track sign-up bonuses, minimum spend progress, and anniversary dates',
        'Annual fee tracker with keep / cancel / downgrade recommendations',
      ]}
    />
  )
}
