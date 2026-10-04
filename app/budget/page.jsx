'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useShell } from '../shellContext.js'
import Budget from '../../src/modules/budget/Budget.jsx'

// /budget?view=outlook&scenario=<id> opens the 5-year outlook with that
// scenario preselected (used by the Scenarios "View in 5-year outlook" link).
function BudgetRoute() {
  const { userId, mobile } = useShell()
  const params = useSearchParams()
  return (
    <Budget
      userId={userId}
      mobile={mobile}
      initialView={params.get('view') === 'outlook' ? 'outlook' : 'detailed'}
      initialScenarioId={params.get('scenario')}
    />
  )
}

export default function BudgetPage() {
  return (
    <Suspense fallback={null}>
      <BudgetRoute />
    </Suspense>
  )
}
