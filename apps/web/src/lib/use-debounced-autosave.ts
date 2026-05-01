'use client';

import { useCallback, useEffect, useRef } from 'react';

type AutosaveOptions = {
  delayMs?: number;
  // When provided, overrides the internal "broker has edited at least
  // once" gate. Lets the wizard shell drive the autosave from a derived
  // hasBrokerEdits flag instead of the local markDirty path.
  enabled?: boolean;
};

export function useDebouncedAutosave<T>(
  value: T,
  onSave: (value: T) => void,
  opts: AutosaveOptions = {},
): () => void {
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const dirtyRef = useRef(false);
  const delayMs = opts.delayMs ?? 500;
  const { enabled } = opts;

  useEffect(() => {
    const allow = enabled !== undefined ? enabled : dirtyRef.current;
    if (!allow) return;
    const timer = window.setTimeout(() => onSaveRef.current(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs, enabled]);

  return useCallback(() => {
    dirtyRef.current = true;
  }, []);
}
