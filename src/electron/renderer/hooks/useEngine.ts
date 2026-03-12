import { useState, useEffect, useRef } from 'react';
import type { QlaudeExecutionState } from '../types/global';

export type EngineState = 'idle' | 'running' | 'paused' | 'stopped';

export interface UseEngineResult {
  engineState: EngineState;
  stateType: string;
  isPaused: boolean;
}

const RUNNING_STATE_TYPES = new Set(['PROCESSING', 'TASK_STARTED', 'EXECUTING']);
const IDLE_STATE_TYPES = new Set(['READY', 'IDLE', 'TASK_COMPLETED', 'TASK_FAILED', 'INTERRUPTED']);

function stateTypeToEngineState(stateType: string, current: EngineState): EngineState {
  if (stateType === 'PAUSED') return 'paused';
  if (RUNNING_STATE_TYPES.has(stateType)) return 'running';
  if (IDLE_STATE_TYPES.has(stateType)) {
    // Only transition to idle if we were running or already idle
    if (current === 'paused') return 'paused';
    return 'idle';
  }
  return current;
}

/**
 * Subscribes to execution state changes and derives a high-level engine state.
 */
export function useEngine(): UseEngineResult {
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [stateType, setStateType] = useState<string>('IDLE');
  const engineStateRef = useRef<EngineState>('idle');

  useEffect(() => {
    const unsubscribe = window.qlaude.execution.onStateChange((state: QlaudeExecutionState) => {
      const incoming = state?.type ?? '';
      setStateType(incoming);
      const next = stateTypeToEngineState(incoming, engineStateRef.current);
      engineStateRef.current = next;
      setEngineState(next);
    });
    return unsubscribe;
  }, []);

  return {
    engineState,
    stateType,
    isPaused: engineState === 'paused',
  };
}
