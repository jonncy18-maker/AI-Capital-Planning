'use client'

import { useShell } from '../shellContext.js'
import Scenarios from '../../src/modules/scenarios/Scenarios.jsx'

export default function ScenariosPage() {
  const { userId, mobile, dataNonce, setDataNonce, aiContext, reloadAiContext, openScenarioId, selectModule } = useShell()

  return (
    <Scenarios
      userId={userId}
      mobile={mobile}
      reloadSignal={dataNonce}
      context={aiContext}
      onDataChange={() => { setDataNonce(n => n + 1); reloadAiContext() }}
      openScenarioId={openScenarioId}
      onGoToForecast={() => selectModule('forecast')}
    />
  )
}
