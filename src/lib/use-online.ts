import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

/** Whether the browser says it is online. The server render and the first client render say yes, so the page never starts with a false "offline". */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
