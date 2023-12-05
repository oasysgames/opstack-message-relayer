import { Gauge, Counter } from '@eth-optimism/common-ts'

export type MessageRelayerMetrics = {
  highestKnownL2: Gauge
  highestProvenL2: Gauge
  highestFinalizedL2: Gauge
  numRelayedMessages: Counter
}

export type MessageRelayerState = {
  highestKnownL2: number
  highestProvenL2: number
  highestFinalizedL2: number
}
