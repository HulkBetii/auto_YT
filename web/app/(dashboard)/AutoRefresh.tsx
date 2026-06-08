"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps every dashboard page "live" by periodically re-running the server
 * component's data fetch (router.refresh() re-renders the current route's
 * server components with fresh data, without a full page reload or losing
 * client state like scroll position / open menus).
 *
 * Why this exists: all dashboard pages here are `force-dynamic` server
 * components that query the DB on render — but Next.js only re-renders them
 * on navigation. Without this, an operator watching e.g. the overview or a
 * video's pipeline timeline would see stale `topic`/`outline`/`done` statuses
 * until they manually hit reload, even though the worker + cron are actively
 * advancing things in the background every few minutes.
 *
 * Polls every 15s and only while the tab is visible — avoids wasting DB
 * queries (and Vercel function invocations) on backgrounded/inactive tabs.
 * Mounted once in the dashboard layout so it covers every page under it.
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const id = setInterval(tick, intervalMs);
    // Also refresh immediately when the tab regains focus/visibility — covers
    // the common case of switching back after the data went stale while away.
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);

  return null;
}
