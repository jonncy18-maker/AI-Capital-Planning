'use client'

import { useShell } from '../shellContext.js'
import Forecast from '../../src/modules/forecast/Forecast.jsx'

export default function ForecastPage() {
  const { userId, mobile, dataNonce, setDataNonce, reloadAiContext } = useShell()

  return (
    <Forecast
      userId={userId}
      mobile={mobile}
      reloadSignal={dataNonce}
      onDataChange={() => { setDataNonce(n => n + 1); reloadAiContext() }}
    />
  )
}
