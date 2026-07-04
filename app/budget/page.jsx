'use client'

import { useShell } from '../shellContext.js'
import Budget from '../../src/modules/budget/Budget.jsx'

export default function BudgetPage() {
  const { userId, mobile } = useShell()
  return <Budget userId={userId} mobile={mobile} />
}
