export interface AsyncMutationGuard {
  run<T>(key: string, operation: () => Promise<T>): Promise<T | undefined>;
  isActive(key: string): boolean;
}

export function createAsyncMutationGuard(): AsyncMutationGuard {
  const active = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, operation: () => Promise<T>): Promise<T | undefined> {
      if (active.has(key)) return Promise.resolve<T | undefined>(undefined);

      const promise: Promise<T> = Promise.resolve()
        .then(operation)
        .finally(() => active.delete(key));
      active.set(key, promise);
      return promise;
    },
    isActive: key => active.has(key),
  };
}
