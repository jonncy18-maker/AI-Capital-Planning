'use client'

import { useShell } from '../shellContext.js'
import Commitments from '../../src/modules/commitments/Commitments.jsx'

export default function CommitmentsPage() {
  const { userId, mobile } = useShell()
  return <Commitments userId={userId} mobile={mobile} />
}
