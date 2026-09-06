import { AsyncLocalStorage } from 'node:async_hooks'
import type { RelinkDataProvider } from './dataProvider.js'

export type AgentRuntimeContext = {
  provider: RelinkDataProvider
  dataDir: string
}

const context = new AsyncLocalStorage<AgentRuntimeContext>()

export function runWithAgentRuntimeContext<T>(value: AgentRuntimeContext, operation: () => T | Promise<T>): T | Promise<T> {
  return context.run(value, operation)
}

export function currentAgentRuntimeContext(): AgentRuntimeContext | undefined {
  return context.getStore()
}
