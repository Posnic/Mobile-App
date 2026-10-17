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
}: {
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
      setMessage("Choose no more than 100 records per change.");
      return;
    }
    setBusy(true);
    setMessage("Sending changes. Waiting for server confirmation…");
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
          ? "Some products changed on the server. Review the refreshed records before trying again."
          : "Server confirmed. Other tills receive this change when they sync. Offline tills must reconnect. Restored products return after catalogue sync.",
      );
    } catch {
      // Retain the same operation identity after a lost response.
      setMessage(
        "Not confirmed. Check your connection and retry. The server may have received the request; retrying will not duplicate it.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ ...text, fontSize: 20, fontWeight: "700" }}>
        {review ? "Review availability changes" : "Product availability"}
      </Text>
      <Text style={{ color: colors.muted }}>
        Choose each record explicitly. Hidden products retain stock, receipts
        and history.
      </Text>
      {different && (
        <Text style={{ ...text, fontWeight: "700" }}>
          Different selling prices — check carefully
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
            Price includes tax · SKU {i.sku || "—"}
          </Text>
          <Text style={{ color: colors.muted }}>
            Barcode:{" "}
            {[...new Set([i.barcode, ...(i.barcodes || [])])]
              .filter(Boolean)
              .join(" · ") || "—"}
          </Text>
          <Text style={{ color: colors.muted }}>
            Stock: {i.quantity === null ? "—" : i.quantity / 1000} {i.unit} ·{" "}
            {i.supplierName || "No supplier"}
          </Text>
          {review && (
            <Text style={{ color: colors.muted }}>Record: {i.id}</Text>
          )}
          {review ? (
            <Text style={text}>
              {i.availableForSale === false ? "Hidden" : "Available"} →{" "}
              {changes[i.id] ? "Available for sale" : "Hidden from sales"}
            </Text>
          ) : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={text}>Available for sale</Text>
              <Switch
                accessibilityLabel={"Available for sale: " + i.name}
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
      {offline && (
        <Text style={text}>
          Offline snapshot. Reconnect to confirm availability changes.
        </Text>
      )}
      {!!message && (
        <Text accessibilityRole="alert" style={text}>
          {message}
        </Text>
      )}
      {!review && selected.length > 0 && (
        <Pressable style={button} onPress={() => setReview(true)}>
          <Feather name="check-square" size={20} color={colors.accent} />
          <Text style={text}>Review {selected.length} changes</Text>
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
              {busy ? "Waiting for server…" : "Confirm changes"}
            </Text>
          </Pressable>
          <Pressable
            disabled={busy}
            style={button}
            onPress={() => setReview(false)}
          >
            <Text style={text}>Back to selection</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
