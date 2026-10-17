import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import type { Repository } from "../data/repository";
import type { Shop } from "../domain/types";
import type {
  InventoryDraft,
  InventoryFilter,
  InventoryItem,
  InventoryMode,
  InventoryOperation,
  InventoryReference,
} from "../domain/inventory";
import { inventoryPayload } from "../domain/inventory";
import { normalizeDigits } from "../domain/money";
import { InventoryApi } from "../services/inventory";
import { ProductAvailability } from "./ProductAvailability";
import { ApiError } from "../services/api";
type Props = {
  repo: Repository;
  shop: Shop;
  t: (key: string) => string;
  back: () => void;
  colors: {
    ink: string;
    muted: string;
    surface: string;
    line: string;
    accent: string;
    tint: string;
  };
};
export function Inventory({ repo, shop, t, back, colors }: Props) {
  const store = useMemo(
    () => repo.inventory(shop),
    [repo, shop.id, shop.branchId, shop.staffId, shop.baseUrl],
  );
  const api = useMemo(
    () => new InventoryApi(shop),
    [shop.id, shop.branchId, shop.staffId, shop.baseUrl],
  );
  const [view, setView] = useState("home"),
    [kind, setKind] = useState("items"),
    [query, setQuery] = useState("");
  const [barcodeFilter, setBarcodeFilter] = useState("");
  const [filter, setFilter] = useState<InventoryFilter | undefined>();
  const [rows, setRows] = useState<(InventoryItem | InventoryReference)[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<InventoryDraft[]>([]),
    [draft, setDraft] = useState<InventoryDraft | null>(null);
  const [operations, setOperations] = useState<InventoryOperation[]>([]),
    [selectedOperation, setSelectedOperation] =
      useState<InventoryOperation | null>(null);
  const [movements, setMovements] = useState<
    Awaited<ReturnType<InventoryApi["history"]>>["rows"]
  >([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null),
    [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [offline, setOffline] = useState(false),
    [asOf, setAsOf] = useState("");
  const [canWrite, setCanWrite] = useState(
      shop.permissions.inventoryWrite === true,
    ),
    [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  useEffect(
    () => setCanWrite(shop.permissions.inventoryWrite === true),
    [shop.permissions.inventoryWrite],
  );
  const alive = useRef(true);
  const lock = useRef(false),
    sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    void store.drafts().then(setDrafts);
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [store]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(t(e instanceof Error ? e.message : "unknownError"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function load(
    search = query,
    after = "",
    catalogue = kind,
    selectedFilter: InventoryFilter | null = filter || null,
    exactBarcode = barcodeFilter,
  ) {
    const request = ++sequence.current;
    const cachedPage = async (offset: number) => {
      const found = await store.cached(
        catalogue,
        search,
        offset,
        201,
        catalogue === "items" ? selectedFilter || undefined : undefined,
      );
      if (request !== sequence.current) return;
      const exact = exactBarcode
        ? found.filter(
            (r) =>
              "tracked" in r &&
              (r.barcode === exactBarcode ||
                r.barcodes?.includes(exactBarcode)),
          )
        : found;
      setRows((old) =>
        offset ? [...old, ...exact.slice(0, 200)] : exact.slice(0, 200),
      );
      setNext(found.length > 200 ? "offline:" + (offset + 200) : null);
      setOffline(true);
      setMessage("");
    };
    if (after.startsWith("offline:")) return cachedPage(Number(after.slice(8)));
    try {
      let cursor = after;
      let page;
      do {
        page = await api.catalogue(
          catalogue,
          catalogue === "items" ? search : "",
          cursor,
          exactBarcode,
        );
        if (request !== sequence.current) return;
        await store.cache(
          catalogue,
          search + ":" + cursor,
          page.rows,
          page.asOf,
        );
        if (catalogue === "items" && selectedFilter) {
          page.rows = page.rows.filter(
            (r) =>
              "tracked" in r &&
              (selectedFilter.kind === "suppliers"
                ? r.supplierId
                : r.categoryId) === selectedFilter.id,
          );
        }
        if (catalogue !== "items" && search.trim())
          page.rows = page.rows.filter((r) =>
            r.name
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
          );
        cursor = page.next || "";
      } while (
        ((selectedFilter && catalogue === "items") ||
          (catalogue !== "items" && search.trim())) &&
        !page.rows.length &&
        cursor
      );
      if (request !== sequence.current) return;

      setRows((old) => (after ? [...old, ...page.rows] : page.rows));
      setNext(page.next);
      setCanWrite(page.permissions.write);
      setOffline(false);
      setAsOf(page.asOf);
    } catch (e) {
      if (request !== sequence.current) return;
      if (!(e instanceof ApiError) || (e.status !== 0 && e.status < 500)) {
        setCanWrite(false);
        setRows([]);
        throw e;
      }
      await cachedPage(0);
    }
  }
  async function browse(
    catalogue = "items",
    selectedFilter: InventoryFilter | null = filter || null,
  ) {
    setBarcodeFilter("");
    setKind(catalogue);
    setQuery("");
    setRows([]);
    setNext(null);
    setView("find");
    await load("", "", catalogue, selectedFilter, "");
  }
  async function download() {
    const generation = Crypto.randomUUID(),
      started = new Date().toISOString();
    for (const catalogue of [
      "items",
      "categories",
      ...(shop.permissions.supplierRead ? ["suppliers"] : []),
    ]) {
      let after = "",
        pageNumber = 0;
      do {
        if (!alive.current) return;
        const page = await api.catalogue(catalogue, "", after);
        if (!alive.current) return;
        await store.stage(catalogue, generation, pageNumber++, page.rows);
        after = page.next || "";
        setMessage(
          t("offlineData") + " · " + catalogue + " · " + pageNumber * 200,
        );
      } while (after);
      await store.activate(catalogue, generation, pageNumber, started);
    }
    setMessage(t("inventorycomplete"));
  }
  async function save(value: InventoryDraft) {
    await store.save(value);
    setDraft(value);
    setDrafts(await store.drafts());
  }
  async function start(
    mode: InventoryMode,
    selectedFilter: InventoryFilter | null = filter || null,
  ) {
    const value: InventoryDraft = {
      id: Crypto.randomUUID(),
      mode,
      reason: "",
      state: "draft",
      createdAt: new Date().toISOString(),
      lines: [],
      filter: selectedFilter || undefined,
    };
    await save(value);
    await browse("items", selectedFilter);
  }
  async function openItem(item: InventoryItem) {
    setSelected(item);
    setQuantity(
      draft?.lines.find((l) => l.item.id === item.id)?.quantity !== undefined
        ? String(
            draft.lines.find((l) => l.item.id === item.id)!.quantity / 1000,
          )
        : draft?.mode === "count"
          ? ""
          : "1",
    );
    setView("item");
  }
  async function add() {
    if (!draft || !selected) return;
    const text = normalizeDigits(quantity.trim()).replace(/[,\u066b]/g, ".");
    if (!/^\d+(\.\d{1,3})?$/.test(text)) throw Error("invalidQuantity");
    const value = Math.round(Number(text) * 1000);
    if (
      (!selected.quantityScale && value % 1000) ||
      !Number.isSafeInteger(value) ||
      value > 999999999 ||
      (draft.mode !== "count" && value === 0)
    )
      throw Error("invalidQuantity");
    if (
      draft.lines.length >= 200 &&
      !draft.lines.some((l) => l.item.id === selected.id)
    )
      throw Error("inventoryLineLimit");
    await save({
      ...draft,
      lines: [
        ...draft.lines.filter((l) => l.item.id !== selected.id),
        { item: selected, quantity: value },
      ],
    });
    setView("find");
  }
  async function submit() {
    if (!draft) return;
    if (draft.mode === "count" && (await repo.load()).outbox.length)
      throw Error("signOutPending");
    inventoryPayload(draft);
    let value = { ...draft, state: "sending" as const };
    // Freeze before networking. A timeout retries the same identity and contents.
    await save(value);
    const operation = draft.operation
      ? await api.status(draft.operation.operationId)
      : await api.prepare(draft);
    const saved = { ...value, state: "submitted" as const, operation };
    await save(saved);
    setView("review");
  }
  async function confirm() {
    if (!draft?.operation) return;
    if (draft.mode === "count" && (await repo.load()).outbox.length)
      throw Error("signOutPending");
    const operation = await api.confirm(draft.operation.operationId);
    await save({ ...draft, operation });
    setMessage(
      t(
        operation.state === "complete"
          ? "inventoryComplete"
          : "inventoryConflict",
      ),
    );
  }
  type Glyph = React.ComponentProps<typeof Feather>["name"];
  const modeIcon: Record<InventoryMode, Glyph> = {
    count: "clipboard",
    receive: "truck",
    damage: "alert-triangle",
    loss: "minus-circle",
  };
  const glyph = (name: Glyph, size = 20, color = colors.accent) => (
    <Feather name={name} size={size} color={color} />
  );
  const s = StyleSheet.create({
    root: { gap: 16 },
    heading: { color: colors.ink, fontSize: 24, fontWeight: "700" },
    text: { color: colors.ink, fontSize: 16 },
    strong: { color: colors.ink, fontSize: 16, fontWeight: "600" },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 16,
      padding: 16,
      gap: 8,
    },
    list: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 16,
      padding: 14,
      minHeight: 70,
    },
    badge: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: colors.tint,
      alignItems: "center",
      justifyContent: "center",
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      borderRadius: 13,
      padding: 13,
      minHeight: 48,
      backgroundColor: colors.surface,
      borderColor: colors.line,
      borderWidth: 1,
    },
    tile: {
      flex: 1,
      minWidth: "44%",
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 18,
      padding: 16,
      gap: 14,
      backgroundColor: colors.surface,
    },
    input: {
      color: colors.ink,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 13,
      padding: 13,
      fontSize: 16,
      minHeight: 48,
    },
    notice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 13,
      borderRadius: 13,
      backgroundColor: colors.tint,
    },
    image: { width: 64, height: 64, borderRadius: 12 },
  });
  const actionIcon = (label: string): Glyph => {
    if (label === t("inventoryDiscard") || label === t("inventoryRemoveLine"))
      return "trash-2";
    if (label === t("edit")) return "edit-2";
    if (label === t("refresh") || label === t("retry")) return "refresh-cw";
    if (label === t("inventoryHistory")) return "clock";
    if (label === t("inventoryAddItems")) return "plus";
    if (label === t("cancel")) return "x";
    if (
      [t("save"), t("inventoryConfirm"), t("inventoryApprove")].includes(label)
    )
      return "check";
    return "arrow-right";
  };
  const button = (
    label: string,
    action: () => Promise<void> | void,
    enabled = true,
    icon?: Glyph,
    primary = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || !enabled}
      accessibilityState={{ disabled: busy || !enabled }}
      style={[
        s.button,
        primary && {
          backgroundColor: colors.accent,
          borderColor: colors.accent,
        },
        (!enabled || busy) && { opacity: 0.45 },
      ]}
      onPress={() =>
        void run(async () => {
          await action();
        })
      }
    >
      {glyph(icon || actionIcon(label), 19, primary ? "#fff" : colors.accent)}
      <Text style={[s.strong, primary && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
  const iconButton = (
    label: string,
    icon: Glyph,
    action: () => Promise<void> | void,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      style={[s.button, { width: 48, padding: 0 }, busy && { opacity: 0.45 }]}
      onPress={() =>
        void run(async () => {
          await action();
        })
      }
    >
      {glyph(icon)}
    </Pressable>
  );
  const openReferences = async (referenceKind: "suppliers" | "categories") => {
    await browse(referenceKind);
  };
  const chooseReference = async (r: InventoryReference) => {
    const value: InventoryFilter = {
      kind: kind as "suppliers" | "categories",
      id: r.id,
      name: r.name,
    };
    setFilter(value);
    if (draft?.state === "draft") await save({ ...draft, filter: value });
    await browse("items", value);
  };
  const goBack = () => {
    setScanning(false);
    if (view === "home") return back();
    if (view === "item") {
      setView("find");
      return;
    }
    if (view === "review") {
      void run(() => browse("items", draft?.filter || null));
      return;
    }
    if (view === "itemHistory") {
      setView("item");
      return;
    }
    setView("home");
  };
  const title = (key: string) => <Text style={s.heading}>{t(key)}</Text>;
  const lineText = (o: InventoryOperation) => (
    <View style={s.card}>
      <Text style={s.text}>{t("inventory" + o.state)}</Text>
      <Text style={s.muted}>{o.reason}</Text>
      {o.lines.map((l) => (
        <Text key={l.itemId} style={s.text}>
          {l.name} · {(l.actualOpening ?? l.expected) / 1000} →{" "}
          {l.actualClosing !== undefined
            ? l.actualClosing / 1000
            : o.mode === "count"
              ? l.quantity / 1000
              : (l.expected + (o.mode === "receive" ? 1 : -1) * l.quantity) /
                1000}
          {o.applied.includes(l.itemId) ? " ✓" : ""}
        </Text>
      ))}
    </View>
  );
  return (
    <View style={s.root}>
      <View style={[s.row, { flexWrap: "nowrap" }]}>
        {iconButton(t("back"), "arrow-left", goBack)}
        <View style={{ flex: 1 }}>
          {title(
            view === "home"
              ? "inventory"
              : kind !== "items" && view === "find"
                ? kind === "suppliers"
                  ? "inventorySuppliers"
                  : "categories"
                : view === "review"
                  ? "inventoryReview"
                  : draft
                    ? "inventory" + draft.mode
                    : "inventoryFind",
          )}
          {view !== "home" && (
            <Text style={s.muted}>
              {view === "availability"
                ? "Review first. Changes apply only after server confirmation."
                : t("inventoryDraftHelp")}
            </Text>
          )}
        </View>
      </View>
      {busy && <ActivityIndicator color={colors.accent} />}
      {!!message && (
        <View accessibilityLiveRegion="polite" style={s.notice}>
          <Text style={s.text}>{message}</Text>
        </View>
      )}
      {view === "home" && (
        <>
          {button(
            t("inventoryFind"),
            () => {
              setDraft(null);
              setFilter(undefined);
              return browse("items", null);
            },
            true,
            "search",
          )}
          <View style={s.row}>
            {(["count", "receive", "damage", "loss"] as InventoryMode[]).map(
              (mode) => (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityLabel={t("inventory" + mode)}
                  disabled={busy || !canWrite}
                  style={[s.tile, (!canWrite || busy) && { opacity: 0.45 }]}
                  onPress={() => {
                    setFilter(undefined);
                    void run(() => start(mode, null));
                  }}
                >
                  <View style={s.row}>
                    <View style={s.badge}>{glyph(modeIcon[mode], 23)}</View>
                    <View style={{ flex: 1 }} />
                    {glyph("arrow-up-right", 17)}
                  </View>
                  <Text style={s.strong}>{t("inventory" + mode)}</Text>
                </Pressable>
              ),
            )}
          </View>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              {button(
                t("categories"),
                () => {
                  setDraft(null);
                  return openReferences("categories");
                },
                true,
                "grid",
              )}
            </View>
            {shop.permissions.supplierRead && (
              <View style={{ flex: 1 }}>
                {button(
                  t("inventorySuppliers"),
                  () => {
                    setDraft(null);
                    return openReferences("suppliers");
                  },
                  true,
                  "users",
                )}
              </View>
            )}
          </View>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            {title("inventoryDrafts")}
            <Text style={s.muted}>{drafts.length}</Text>
          </View>
          {!drafts.length && (
            <View style={s.notice}>
              {glyph("file-text")}
              <Text style={s.muted}>{t("inventoryNoDrafts")}</Text>
            </View>
          )}
          {drafts.map((d) => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={
                t("inventory" + d.mode) +
                " · " +
                d.lines.length +
                " · " +
                new Date(d.createdAt).toLocaleDateString()
              }
              style={s.list}
              onPress={() => {
                setDraft(d);
                setFilter(d.filter);
                setKind("items");
                setView("review");
              }}
            >
              <View style={s.badge}>{glyph(modeIcon[d.mode])}</View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.strong}>{t("inventory" + d.mode)}</Text>
                <Text style={s.muted}>
                  {d.lines.length} ·{" "}
                  {new Date(d.createdAt).toLocaleDateString()}
                  {d.filter ? " · " + d.filter.name : ""}
                </Text>
              </View>
              {glyph("chevron-right", 18)}
            </Pressable>
          ))}
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              {button(
                t("inventoryHistory"),
                async () => {
                  const page = await api.operations();
                  setOperations(page.rows);
                  setNext(page.next);
                  setSelectedOperation(null);
                  setView("history");
                },
                true,
                "clock",
              )}
            </View>
            {iconButton(
              t("offlineData") + " · " + t("refresh"),
              "download-cloud",
              download,
            )}
          </View>
          <Text style={s.muted}>{t("inventoryDraftHelp")}</Text>
        </>
      )}
      {view === "find" && (
        <>
          <View style={[s.row, { flexWrap: "nowrap" }]}>
            <View style={{ flex: 1 }}>
              <TextInput
                accessibilityLabel={t("search")}
                value={query}
                onChangeText={(value) => {
                  setBarcodeFilter("");
                  setQuery(value);
                }}
                onSubmitEditing={() => void run(() => load())}
                returnKeyType="search"
                placeholder={
                  kind === "items"
                    ? t("search")
                    : t(
                        kind === "suppliers"
                          ? "inventorySuppliers"
                          : "categories",
                      )
                }
                placeholderTextColor={colors.muted}
                style={s.input}
              />
            </View>
            {iconButton(t("search"), "search", () => load())}
            {kind === "items" &&
              iconButton(t("scan"), "maximize", async () => {
                const p = permission?.granted
                  ? permission
                  : await requestPermission();
                if (p.granted) setScanning(true);
                else setMessage(t("cameraPermission"));
              })}
          </View>
          {kind === "items" && (
            <View style={s.row}>
              {button(
                t("categories"),
                () => openReferences("categories"),
                true,
                "grid",
              )}
              {shop.permissions.supplierRead &&
                button(
                  t("inventorySuppliers"),
                  () => openReferences("suppliers"),
                  true,
                  "users",
                )}
              {iconButton(t("refresh"), "refresh-cw", () => load())}
            </View>
          )}
          {filter && kind === "items" && (
            <View style={s.notice}>
              {glyph(filter.kind === "suppliers" ? "users" : "grid")}
              <Text style={[s.strong, { flex: 1 }]}>{filter.name}</Text>
              {iconButton(t("cancel"), "x", async () => {
                setFilter(undefined);
                if (draft?.state === "draft")
                  await save({ ...draft, filter: undefined });
                await load(query, "", "items", null);
              })}
            </View>
          )}
          {!draft &&
            filter &&
            kind === "items" &&
            canWrite &&
            button(
              t("inventoryreceive"),
              () => start("receive"),
              true,
              "truck",
              true,
            )}
          {scanning && (
            <CameraView
              style={{ height: 240 }}
              barcodeScannerSettings={{
                barcodeTypes: [
                  "ean13",
                  "ean8",
                  "code128",
                  "code39",
                  "qr",
                  "upc_a",
                  "upc_e",
                  "itf14",
                ],
              }}
              onBarcodeScanned={({ data }) => {
                setScanning(false);
                setQuery(data);
                setBarcodeFilter(data);
                void run(async () => {
                  await load(data, "", "items", null, data);
                  if (!draft) setView("availability");
                });
              }}
            />
          )}
          {offline && (
            <View style={s.notice}>
              {glyph("wifi-off")}
              <Text style={[s.muted, { flex: 1 }]}>
                {t("inventoryOffline")}
              </Text>
            </View>
          )}
          {draft &&
            button(
              t("inventoryReview") + " · " + draft.lines.length,
              () => setView("review"),
              true,
              "shopping-bag",
              true,
            )}
          {!draft &&
            kind === "items" &&
            rows.some((r) => "tracked" in r) &&
            button(
              t("availabilityOpen"),
              () => setView("availability"),
              true,
              "eye",
            )}
          {rows.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              disabled={busy}
              style={s.list}
              onPress={() =>
                void run(() =>
                  "tracked" in r ? openItem(r) : chooseReference(r),
                )
              }
            >
              {"tracked" in r && r.image ? (
                <Image
                  source={{ uri: r.image }}
                  style={{ width: 44, height: 44, borderRadius: 12 }}
                />
              ) : (
                <View style={s.badge}>
                  {glyph(
                    "tracked" in r
                      ? "package"
                      : kind === "suppliers"
                        ? "users"
                        : "grid",
                  )}
                </View>
              )}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.strong}>{r.name}</Text>
                {"tracked" in r && (
                  <Text style={s.muted}>
                    {r.quantity === null ? "—" : r.quantity / 1000} {r.unit}
                    {r.supplierName ? " · " + r.supplierName : ""}
                    {!r.active ? " · " + t("inventoryInactive") : ""}
                  </Text>
                )}
              </View>
              {glyph("chevron-right", 18)}
            </Pressable>
          ))}
          {!rows.length && <Text style={s.muted}>{t("noItems")}</Text>}
          {next && button(t("loadMore"), () => load(query, next))}
        </>
      )}
      {view === "availability" && (
        <>
          <ProductAvailability
            t={t}
            items={rows.filter((r): r is InventoryItem => "tracked" in r)}
            shop={shop}
            api={api}
            repo={repo}
            canWrite={canWrite}
            offline={offline}
            colors={colors}
            done={() => load()}
          />
          {!rows.length && <Text style={s.muted}>{t("noItems")}</Text>}
          {next && button(t("loadMore"), () => load(query, next))}
        </>
      )}
      {view === "item" && selected && (
        <>
          <View style={s.card}>
            {selected.image && (
              <Image source={{ uri: selected.image }} style={s.image} />
            )}
            <Text style={s.heading}>{selected.name}</Text>
            <Text style={s.text}>
              {t("inventoryOnHand")}:{" "}
              {selected.quantity === null ? "—" : selected.quantity / 1000}{" "}
              {selected.unit}
            </Text>
            <Text style={s.muted}>
              {selected.barcode} · {selected.category} · {selected.supplierName}
            </Text>
          </View>
          {!draft && (
            <ProductAvailability
              t={t}
              key={selected.id}
              items={[selected]}
              shop={shop}
              api={api}
              repo={repo}
              canWrite={canWrite}
              offline={offline}
              colors={colors}
              done={async () => {
                const page = await api.catalogue(
                  "items",
                  selected.sku || selected.barcode || selected.name,
                );
                const fresh = page.rows.find((r) => r.id === selected.id);
                if (fresh && "tracked" in fresh) setSelected(fresh);
              }}
            />
          )}
          {!selected.tracked && (
            <Text style={s.muted}>{t("inventoryNotTracked")}</Text>
          )}
          {button(t("inventoryHistory"), async () => {
            const page = await api.history(selected.id);
            setMovements(page.rows);
            setNext(page.next);
            setView("itemHistory");
          })}
          {draft?.state === "draft" && selected.tracked && (
            <>
              <Text style={s.text}>
                {t(draft.mode === "count" ? "inventoryCounted" : "quantity")}
              </Text>
              <View style={[s.card, { gap: 12 }]}>
                <View style={[s.row, { flexWrap: "nowrap" }]}>
                  {iconButton(t("inventoryDecrease"), "minus", () =>
                    setQuantity(String(Math.max(0, Number(quantity || 0) - 1))),
                  )}
                  <TextInput
                    accessibilityLabel={t("quantity")}
                    style={[
                      s.input,
                      {
                        flex: 1,
                        minWidth: 0,
                        width: 0,
                        fontSize: 30,
                        textAlign: "center",
                        fontWeight: "600",
                      },
                    ]}
                    keyboardType="decimal-pad"
                    value={quantity}
                    onChangeText={setQuantity}
                  />
                  {iconButton(t("inventoryIncrease"), "plus", () =>
                    setQuantity(String(Number(quantity || 0) + 1)),
                  )}
                </View>
                <Text style={[s.muted, { textAlign: "center" }]}>
                  {selected.unit}
                </Text>
              </View>
              {button(t("save"), add, true, "check", true)}
            </>
          )}
        </>
      )}
      {view === "review" && draft && (
        <>
          <View style={s.notice}>
            {glyph(modeIcon[draft.mode])}
            <Text style={s.strong}>{t("inventory" + draft.mode)}</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.muted}>{draft.lines.length}</Text>
          </View>
          {draft.operation
            ? lineText(draft.operation)
            : draft.lines.map((l) => (
                <View key={l.item.id} style={s.card}>
                  <Text style={s.text}>
                    {l.item.name} · {l.quantity / 1000} {l.item.unit}
                  </Text>
                  {draft.state === "draft" && (
                    <View style={s.row}>
                      {iconButton(t("edit"), "edit-2", () => openItem(l.item))}
                      {iconButton(t("inventoryRemoveLine"), "trash-2", () =>
                        save({
                          ...draft,
                          lines: draft.lines.filter(
                            (v) => v.item.id !== l.item.id,
                          ),
                        }),
                      )}
                    </View>
                  )}
                </View>
              ))}
          {draft.state === "draft" ? (
            <>
              {button(t("inventoryAddItems"), () => browse())}
              <Text style={s.strong}>{t("inventoryReason")}</Text>
              <TextInput
                accessibilityLabel={t("inventoryReason")}
                placeholder={t("inventoryReason")}
                placeholderTextColor={colors.muted}
                multiline
                maxLength={500}
                style={s.input}
                value={draft.reason}
                onChangeText={(reason) => {
                  const value = { ...draft, reason };
                  setDraft(value);
                  void store
                    .save(value)
                    .catch(() => setMessage(t("inventoryUncertain")));
                }}
              />
              {button(
                t("inventorySubmit"),
                submit,
                !!draft.lines.length && !!draft.reason.trim(),
                "arrow-right",
                true,
              )}
              {button(t("inventoryDiscard"), async () => {
                await store.discard(draft);
                setDraft(null);
                setDrafts(await store.drafts());
                setView("home");
              })}
            </>
          ) : (
            <>
              {!["complete", "cancelled"].includes(
                draft.operation?.state || "",
              ) && <Text style={s.muted}>{t("inventoryUncertain")}</Text>}
              {button(t("refresh"), submit)}
              {draft.state === "sending" &&
                !draft.operation &&
                button(t("edit"), async () => {
                  const operation = await api.abandonRequest(draft.id);
                  if (operation.state !== "cancelled")
                    await save({ ...draft, state: "submitted", operation });
                  else {
                    const reopened = await store.reopenUnsubmitted(
                      draft,
                      Crypto.randomUUID(),
                    );
                    setDraft(reopened);
                    setDrafts(await store.drafts());
                  }
                })}
              {draft.operation?.state === "prepared" &&
                button(
                  t(
                    draft.operation.approvalRequired
                      ? "inventoryApprove"
                      : "inventoryConfirm",
                  ),
                  confirm,
                  true,
                  "check-circle",
                  true,
                )}
              {draft.operation?.state === "applying" &&
                button(t("retry"), confirm)}
              {draft.operation?.state === "prepared" &&
                button(t("cancel"), async () => {
                  const operation = await api.cancel(
                    draft.operation!.operationId,
                  );
                  await save({ ...draft, operation });
                })}
              {draft.operation?.state === "conflict" && (
                <>
                  <Text style={s.muted}>{t("inventoryConflict")}</Text>
                  {button(t("inventorycount"), () => start("count"))}
                </>
              )}
            </>
          )}
          {!["complete", "cancelled"].includes(
            draft.operation?.state || "",
          ) && <Text style={s.muted}>{t("inventoryOnlineConfirm")}</Text>}
        </>
      )}
      {view === "history" && (
        <>
          {selectedOperation ? (
            <>
              {lineText(selectedOperation)}
              {selectedOperation.state === "prepared" &&
                button(t("inventoryApprove"), async () =>
                  setSelectedOperation(
                    await api.confirm(selectedOperation.operationId),
                  ),
                )}
              {button(t("refresh"), async () =>
                setSelectedOperation(
                  await api.status(selectedOperation.operationId),
                ),
              )}
            </>
          ) : (
            operations.map((o) => (
              <View key={o.operationId}>
                {button(
                  t("inventory" + o.mode) + " · " + t("inventory" + o.state),
                  () => setSelectedOperation(o),
                )}
              </View>
            ))
          )}
          {!selectedOperation &&
            next &&
            button(t("loadMore"), async () => {
              const page = await api.operations(next);
              setOperations([...operations, ...page.rows]);
              setNext(page.next);
            })}
        </>
      )}
      {view === "itemHistory" && selected && (
        <>
          <Text style={s.heading}>{selected.name}</Text>
          {movements.map((m) => (
            <View key={m.id} style={s.card}>
              <Text style={s.text}>
                {m.reason} · {m.opening} → {m.closing}
              </Text>
              <Text style={s.muted}>
                {m.at ? new Date(m.at).toLocaleString() : ""} · {m.actor}
              </Text>
              <Text style={s.muted}>{m.note}</Text>
            </View>
          ))}
          {next &&
            button(t("loadMore"), async () => {
              const page = await api.history(selected.id, next);
              setMovements([...movements, ...page.rows]);
              setNext(page.next);
            })}
        </>
      )}
    </View>
  );
}
