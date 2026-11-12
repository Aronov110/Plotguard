import { useEffect, useState } from "react";

/**
 * How many seconds have passed since `since` (an ISO timestamp), updated every second while `active`.
 * Returns `undefined` when the timestamp is not a date. A clock that is behind the server's gives 0,
 * never a negative number.
 */
export function useElapsedSeconds(since: string, active: boolean): number | undefined {
  const start = Date.parse(since);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);

  if (Number.isNaN(start)) return undefined;
  return Math.max(0, Math.floor((now - start) / 1000));
}
