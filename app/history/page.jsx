'use client'

import { useShell } from '../shellContext.js'
import History from '../../src/modules/history/History.jsx'

export default function HistoryPage() {
  const { userId, mobile } = useShell()
  return <History userId={userId} mobile={mobile} />
}
