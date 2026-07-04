'use client'

import { useShell } from '../shellContext.js'
import CreditCards from '../../src/modules/creditcards/CreditCards.jsx'

export default function CreditCardsPage() {
  const { userId, mobile } = useShell()
  return <CreditCards userId={userId} mobile={mobile} />
}
