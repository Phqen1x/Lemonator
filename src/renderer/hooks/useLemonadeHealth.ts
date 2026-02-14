import { useState, useEffect, useCallback } from 'react'
import { checkHealth } from '../services/lemonade'

export function useLemonadeHealth(pollInterval = 5000) {
  const [isConnected, setIsConnected] = useState(false)
  const [checking, setChecking] = useState(true)

  const check = useCallback(async () => {
    setChecking(true)
    const healthy = await checkHealth()
    setIsConnected(healthy)
    setChecking(false)
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, pollInterval)
    return () => clearInterval(id)
  }, [check, pollInterval])

  return { isConnected, checking, recheckNow: check }
}
