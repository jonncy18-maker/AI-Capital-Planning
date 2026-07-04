'use client'

import { useShell } from '../shellContext.js'
import PayPeriodPlanner from '../../src/modules/payperiods/PayPeriodPlanner.jsx'

export default function PayPeriodsPage() {
  const { userId, mobile } = useShell()
  return <PayPeriodPlanner userId={userId} mobile={mobile} />
}
