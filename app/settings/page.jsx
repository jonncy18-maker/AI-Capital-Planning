'use client'

import { useShell } from '../shellContext.js'
import Settings from '../../src/modules/settings/Settings.jsx'

export default function SettingsPage() {
  const { profile, onProfileSave, reloadAiContext, selectModule, onStartReImport, userId, aiContext } = useShell()

  return (
    <Settings
      profile={profile}
      onSave={async (updated) => { await onProfileSave(updated); reloadAiContext() }}
      onBack={() => selectModule('dashboard')}
      onImport={onStartReImport}
      userId={userId}
      context={aiContext}
      onAIPrefsChange={reloadAiContext}
    />
  )
}
