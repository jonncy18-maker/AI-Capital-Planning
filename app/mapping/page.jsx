'use client'

import { useShell } from '../shellContext.js'
import Mapping from '../../src/modules/mapping/Mapping.jsx'

export default function MappingPage() {
  const { userId, mobile } = useShell()
  return <Mapping userId={userId} mobile={mobile} />
}
