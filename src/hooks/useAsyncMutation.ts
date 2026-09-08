import { useCallback, useRef, useState } from 'react';
import { createAsyncMutationGuard } from '../lib/asyncMutation';

export type MutationKey = string;

/**
 * Synchronously coalesces duplicate events for the same logical action.
 * The ref is the source of truth because state updates are asynchronous.
 */
export function useAsyncMutation() {
  const guardRef = useRef(createAsyncMutationGuard());
  const [pendingKeys, setPendingKeys] = useState<Set<MutationKey>>(new Set());

  const run = useCallback(<T,>(key: MutationKey, operation: () => Promise<T>) => {
    const promise = guardRef.current.run(key, async () => {
      setPendingKeys(previous => new Set(previous).add(key));
      try {
        return await operation();
      } finally {
        setPendingKeys(previous => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    });
    return promise;
  }, []);

  const isPending = useCallback((key: MutationKey) => pendingKeys.has(key), [pendingKeys]);

  return { run, isPending };
}
