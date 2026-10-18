import { useSyncExternalStore } from "react";
import { getAnalytics, subscribeAnalytics, type AnalyticsState } from "./store";

export function useAnalytics(): AnalyticsState {
  return useSyncExternalStore(subscribeAnalytics, getAnalytics, getAnalytics);
}
