import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { Shop, Locale } from "../domain/types";
import { openStorage } from "../data/openStorage";
import { ApiError, PosnicApi } from "../services/api";

export function useShopWording(
  shop: Shop | null | undefined,
  locale: Locale,
  locked: boolean,
) {
  const scope =
    shop?.mode === "live" && shop.baseUrl && !locked
      ? JSON.stringify([
          shop.baseUrl,
          shop.id,
          shop.branchId,
          shop.staffId,
          locale,
        ])
      : null;
  const [accepted, setAccepted] = useState<{
    scope: string;
    values: Record<string, string>;
  } | null>(null);
  useEffect(() => {
    let stopped = false,
      busy = false,
      refreshed = false;
    const refresh = async () => {
      if (stopped || busy || !scope || !shop?.baseUrl) return;
      busy = true;
      try {
        const values = await new PosnicApi(shop.baseUrl).wording(shop, locale);
        if (!stopped) {
          refreshed = true;
          setAccepted({ scope, values });
          const store = await openStorage();
          if (!stopped)
            await store.batch([
              { key: "wording-cache", value: { scope, values } },
            ]);
        }
      } catch (error) {
        if (
          !stopped &&
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          refreshed = true;
          setAccepted(null);
          const store = await openStorage();
          if (!stopped)
            await store.batch([{ key: "wording-cache", value: null }]);
        }
      } finally {
        busy = false;
      }
    };
    void (async () => {
      try {
        const store = await openStorage();
        const cached = await store.get<{
          scope: string;
          values: Record<string, string>;
        }>("wording-cache");
        if (
          !stopped &&
          !refreshed &&
          cached?.scope === scope &&
          cached.values &&
          typeof cached.values === "object" &&
          !Array.isArray(cached.values) &&
          Object.keys(cached.values).length <= 10000 &&
          Object.values(cached.values).every(
            (value) => typeof value === "string" && value.length <= 4096,
          )
        )
          setAccepted(cached);
      } catch {
        /* Optional cache must not block sales. */
      }
      await refresh();
    })();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 60000);
    return () => {
      stopped = true;
      listener.remove();
      clearInterval(timer);
    };
  }, [scope]);
  return accepted?.scope === scope ? accepted.values : undefined;
}
