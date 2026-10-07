'use client'

import { useRouter } from 'next/navigation'
import { useShell } from '../shellContext.js'
import Scenarios from '../../src/modules/scenarios/Scenarios.jsx'

export default function ScenariosPage() {
  const {
    userId,
    mobile,
    dataNonce,
    setDataNonce,
    aiContext,
    reloadAiContext,
    openScenarioId,
    selectModule,
  } = useShell()

  const router = useRouter()

  return (
    <Scenarios
      userId={userId}
      mobile={mobile}
      reloadSignal={dataNonce}
      context={aiContext}
      onDataChange={() => {
        setDataNonce((n) => n + 1)
        reloadAiContext()
      }}
      openScenarioId={openScenarioId}
      onGoToForecast={() => selectModule('forecast')}
      onOpenOutlook={(id) => router.push(`/budget?view=outlook&scenario=${encodeURIComponent(id)}`)}
    />
  )
}
