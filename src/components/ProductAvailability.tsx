import React, { useState } from "react";
import { Image, Pressable, Switch, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import type { InventoryItem } from "../domain/inventory";
import type { Shop } from "../domain/types";
import type { Repository } from "../data/repository";
import type { InventoryApi } from "../services/inventory";

export function ProductAvailability({
  items,
  shop,
  api,
  repo,
  canWrite,
  offline,
  done,
  colors,
  t,
}: {
  t: (key: string) => string;
  items: InventoryItem[];
  shop: Shop;
  api: InventoryApi;
  repo: Repository;
  canWrite: boolean;
  offline: boolean;
  done: () => Promise<void>;
  colors: {
    ink: string;
    muted: string;
    surface: string;
    line: string;
    accent: string;
    tint: string;
  };
}) {
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => Crypto.randomUUID());
  const selected = items.filter(
    (i) =>
      changes[i.id] !== undefined &&
      changes[i.id] !== (i.availableForSale !== false),
  );
  const price = (i: InventoryItem) =>
    Math.round(i.price * (i.taxInclusive ? 1 : 1 + i.taxBps / 10000));
  const money = (i: InventoryItem) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: shop.currency,
    }).format(price(i) / 100);
  const different = new Set(items.map(price)).size > 1;
  const text = { color: colors.ink, fontSize: 15 };
  const button = {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.tint,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  };
  async function confirm() {
    if (busy || offline || !canWrite) return;
    if (selected.length > 100) {
      setMessage(t("availability0"));
      return;
    }
    setBusy(true);
    setMessage(t("availability1"));
    try {
      const result = await api.availability(
        requestId,
        selected.map((i) => ({
          itemId: i.id,
          available: changes[i.id]!,
          revision: i.availabilityRevision || "",
        })),
      );
      const confirmed = result.results
        .filter((r) => r.state === "confirmed" && r.item)
        .map((r) => r.item as InventoryItem);
      await repo.applyAvailability(shop, confirmed);
      await repo
        .inventory(shop)
        .cache(
          "items",
          "availability-confirmed",
          confirmed,
          result.confirmedAt,
        );
      setChanges({});
      setReview(false);
      setRequestId(Crypto.randomUUID());
      await done().catch(() => undefined);
      setMessage(
        result.results.some((r) => r.state === "conflict")
          ? t("availability2")
          : t("availability3"),
      );
    } catch {
      // Retain the same operation identity after a lost response.
      setMessage(t("availability4"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ ...text, fontSize: 20, fontWeight: "700" }}>
        {review ? t("availability5") : t("availability6")}
      </Text>
      <Text style={{ color: colors.muted }}>{t("availabilityHelp")}</Text>
      {different && (
        <Text style={{ ...text, fontWeight: "700" }}>
          {t("availabilityPrices")}
        </Text>
      )}
      {(review ? selected : items).map((i) => (
        <View
          key={i.id}
          style={{
            padding: 16,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 16,
            backgroundColor: colors.surface,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {i.image ? (
              <Image
                source={{ uri: i.image }}
                style={{ width: 44, height: 44, borderRadius: 10 }}
              />
            ) : (
              <Feather name="package" size={28} color={colors.accent} />
            )}
            <Text style={{ ...text, flex: 1, fontWeight: "600" }}>
              {i.name}
            </Text>
            <Text style={{ ...text, fontWeight: "700" }}>{money(i)}</Text>
          </View>
          <Text style={{ color: colors.muted }}>
            {t("availabilityPriceTax")} · SKU {i.sku || "—"}
          </Text>
          <Text style={{ color: colors.muted }}>
            {t("availabilityBarcode")}:{" "}
            {[...new Set([i.barcode, ...(i.barcodes || [])])]
              .filter(Boolean)
              .join(" · ") || "—"}
          </Text>
          <Text style={{ color: colors.muted }}>
            {t("availabilityStock")}:{" "}
            {i.quantity === null ? "—" : i.quantity / 1000} {i.unit} ·{" "}
            {i.supplierName || t("availability11")}
          </Text>
          {review && (
            <Text style={{ color: colors.muted }}>
              {t("availabilityRecord")}: {i.id}
            </Text>
          )}
          {review ? (
            <Text style={text}>
              {i.availableForSale === false
                ? t("availability7")
                : t("availability8")}{" "}
              → {changes[i.id] ? t("availability9") : t("availability10")}
            </Text>
          ) : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={text}>{t("availability9")}</Text>
              <Switch
                accessibilityLabel={t("availability9") + ": " + i.name}
                value={changes[i.id] ?? i.availableForSale !== false}
                disabled={!canWrite || busy || offline}
                onValueChange={(value) => {
                  setChanges((c) => ({ ...c, [i.id]: value }));
                  setRequestId(Crypto.randomUUID());
                }}
                trackColor={{ true: colors.accent }}
              />
            </View>
          )}
        </View>
      ))}
      {offline && <Text style={text}>{t("availabilityOffline")}</Text>}
      {!!message && (
        <Text accessibilityRole="alert" style={text}>
          {message}
        </Text>
      )}
      {!review && selected.length > 0 && (
        <Pressable style={button} onPress={() => setReview(true)}>
          <Feather name="check-square" size={20} color={colors.accent} />
          <Text style={text}>
            {t("availabilityReviewCount").replace(
              "{count}",
              String(selected.length),
            )}
          </Text>
        </Pressable>
      )}
      {review && (
        <>
          <Pressable
            disabled={busy || offline || !canWrite}
            style={button}
            onPress={() => void confirm()}
          >
            <Feather name="check" size={20} color={colors.accent} />
            <Text style={text}>
              {busy ? t("availability12") : t("availability13")}
            </Text>
          </Pressable>
          <Pressable
            disabled={busy}
            style={button}
            onPress={() => setReview(false)}
          >
            <Text style={text}>{t("availabilityBack")}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
