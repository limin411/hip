import { useMemo, useSyncExternalStore } from 'react'
import {
  getInFlightVersion,
  listInFlightIds,
  subscribeInFlight,
} from '@/store/automationStore'

/** Reactive set of automation ids currently holding the in-flight claim. */
export function useInFlightIds(): Set<string> {
  const version = useSyncExternalStore(
    subscribeInFlight,
    getInFlightVersion,
    getInFlightVersion,
  )
  return useMemo(() => new Set(listInFlightIds()), [version])
}
