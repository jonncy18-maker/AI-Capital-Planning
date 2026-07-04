'use client'

import { useShell } from '../shellContext.js'
import Dashboard from '../../src/modules/dashboard/Dashboard.jsx'

export default function DashboardPage() {
  const { aiContext, summary, mobile, userId, yearTxns, profile, dataNonce, onProfileSave, reloadAiContext } = useShell()

  return (
    <Dashboard
      context={aiContext}
      summary={summary}
      mobile={mobile}
      userId={userId}
      yearTxns={yearTxns}
      periodOptions={profile?.period_options ?? []}
      periodDefault={profile?.period_default ?? null}
      reloadSignal={dataNonce}
      onThresholdChange={async (val) => {
        await onProfileSave({ ...(profile || {}), varianceThreshold: val })
        reloadAiContext()
      }}
    />
  )
}
