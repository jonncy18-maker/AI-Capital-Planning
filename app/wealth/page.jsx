'use client'

import { useShell } from '../shellContext.js'
import Wealth from '../../src/modules/wealth/Wealth.jsx'

export default function WealthPage() {
  const { userId, mobile, aiContext, yearTxns } = useShell()
  return <Wealth userId={userId} mobile={mobile} aiContext={aiContext} yearTxns={yearTxns} />
}
