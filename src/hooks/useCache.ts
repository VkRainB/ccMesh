import { useCallback, useEffect, useState, type SetStateAction } from "react";

const CHANGE_EVENT = "ccmesh:cache-change";
// 存储被拒绝时只保留当前页面的值，不假装已跨重启持久化。
const transientValues = new Map<string, unknown>();

export function useCache<T>(
  key: string,
  { defaultValue, parse }: { defaultValue: T; parse: (value: unknown) => T },
) {
  const read = useCallback((): T => {
    if (transientValues.has(key)) return parse(transientValues.get(key));
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? defaultValue : parse(JSON.parse(raw));
    } catch {
      return defaultValue;
    }
  }, [key, defaultValue, parse]);
  const [value, setValue] = useState(read);

  useEffect(() => {
    const onChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === key) setValue(read());
    };
    const onStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch { return; }
      if (event.key !== null && event.key !== key) return;
      transientValues.delete(key);
      setValue(read());
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    setValue(read());
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [key, read]);

  const set = useCallback((next: SetStateAction<T>) => {
    const resolved = parse(typeof next === "function"
      ? (next as (previous: T) => T)(read()) : next);
    try {
      window.localStorage.setItem(key, JSON.stringify(resolved));
      transientValues.delete(key);
    } catch {
      transientValues.set(key, resolved);
    }
    setValue(resolved);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
  }, [key, read, parse]);

  return [value, set] as const;
}
