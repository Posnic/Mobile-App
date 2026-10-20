import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  Switch,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Picker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import type { Repository } from "../data/repository";
import type { Item, Shop } from "../domain/types";
import {
  emptyProduct,
  productPayload,
  type ProductDraft,
  type ProductForm,
} from "../domain/product";
import { ProductApi, type ProductOptions } from "../services/products";
import { ShopConnection } from "../services/routes";
import { ApiError } from "../services/api";
import {
  localPhotoReading,
  readLocalPhoto,
} from "../platform/photoRecognition";
type Props = {
  repo: Repository;
  shop: Shop;
  t: (k: string) => string;
  back: () => void;
  saved: (item: Item, add: boolean) => Promise<void>;
  openInventory: () => void;
  colors: {
    ink: string;
    muted: string;
    surface: string;
    line: string;
    accent: string;
    tint: string;
  };
};
export function NewProduct({
  repo,
  shop,
  t,
  back,
  saved,
  openInventory,
  colors: c,
}: Props) {
  const fresh = (): ProductDraft => ({
    id: Crypto.randomUUID(),
    form: emptyProduct(),
    submitted: false,
  });
  const [draft, setDraft] = useState<ProductDraft>(fresh),
    [options, setOptions] = useState<ProductOptions | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [textTarget, setTextTarget] = useState<"name" | "brand" | "sku">(
    "name",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState(false);
  const [scanner, setScanner] = useState(false),
    [matches, setMatches] = useState<Item[]>([]),
    [texts, setTexts] = useState<string[]>([]);
  const [picker, setPicker] = useState<
      "categories" | "suppliers" | "taxes" | "units" | null
    >(null),
    [query, setQuery] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void repo
      .productDraft()
      .then((value) => {
        if (value && alive.current) {
          setDraft(value);
          setReview(value.submitted);
        }
      })
      .catch(() => {
        if (alive.current) setError(t("unknownError"));
      })
      .finally(() => {
        if (alive.current) setLoaded(true);
      });
    void new ProductApi(shop)
      .options()
      .then((value) => {
        if (alive.current) setOptions(value);
      })
      .catch(() => {
        if (alive.current) setNotice(t("productOfflineDraft"));
      });
    return () => {
      alive.current = false;
    };
  }, [repo, shop.baseUrl, shop.id, shop.branchId, shop.staffId]);
  useEffect(() => {
    if (!loaded || draft.submitted) return;
    void repo.saveProductDraft(draft).catch(() => {
      if (alive.current) setError(t("unknownError"));
    });
  }, [draft, loaded, repo]);
  useEffect(() => {
    if (!picker) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void new ProductApi(shop)
        .options(query)
        .then((value) => {
          if (!cancelled) setOptions(value);
        })
        .catch(() => {
          if (!cancelled) setNotice(t("productOfflineDraft"));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picker, query, shop]);
  const update = (key: keyof ProductForm, value: string | boolean) => {
    if (key === "barcode") setMatches([]);
    setDraft((d) => ({ ...d, form: { ...d.form, [key]: value } }));
  };
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : t(e instanceof Error ? e.message : "unknownError"),
      );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const button = (
    label: string,
    icon: React.ComponentProps<typeof Feather>["name"],
    fn: () => void,
    primary = false,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || disabled}
      onPress={fn}
      style={[
        s.button,
        {
          borderColor: c.line,
          backgroundColor: primary ? c.accent : c.surface,
          opacity: busy || disabled ? 0.5 : 1,
        },
      ]}
    >
      <Feather name={icon} size={21} color={primary ? "white" : c.accent} />
      <Text
        style={{
          color: primary ? "white" : c.ink,
          fontWeight: "600",
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const field = (key: keyof ProductForm, label: string, numeric = false) => (
    <View style={s.field}>
      <Text style={{ color: c.muted }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={String(draft.form[key])}
        editable={!busy && !draft.submitted}
        onChangeText={(v) => update(key, v)}
        keyboardType={numeric ? "decimal-pad" : "default"}
        style={[
          s.input,
          { color: c.ink, borderColor: c.line, backgroundColor: c.surface },
        ]}
      />
    </View>
  );
  const toggle = (
    key: "tracked" | "weighed" | "available" | "taxInclusive",
    label: string,
  ) => (
    <View style={s.row}>
      <Text style={{ color: c.ink, flex: 1 }}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={draft.form[key]}
        disabled={busy || draft.submitted}
        onValueChange={(v) => update(key, v)}
        trackColor={{ true: c.accent }}
      />
    </View>
  );
  async function scan(code: string) {
    if (
      !code ||
      code.length > 128 ||
      /[\x00-\x1f\x7f]/.test(code) ||
      /^(https?:|upi:|posnic:)/i.test(code)
    )
      throw Error("invalidScan");
    setScanner(false);
    update("barcode", code);
    setMatches([]);
    try {
      const result = await new ProductApi(shop).lookup(code);
      setMatches(result.rows as Item[]);
      setNotice(
        result.rows.length ? t("productAlreadyExists") : t("productNewBarcode"),
      );
    } catch (e) {
      setNotice(t("productOfflineDraft"));
      throw e;
    }
  }
  async function photo() {
    if (!(await Picker.requestCameraPermissionsAsync()).granted)
      throw Error("permissionDenied");
    const picked = await Picker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      exif: false,
    });
    if (picked.canceled) return;
    const a = picked.assets[0]!;
    const converted = await manipulateAsync(
      a.uri,
      [{ resize: a.width > a.height ? { width: 1200 } : { height: 1200 } }],
      { base64: true, compress: 0.65, format: SaveFormat.JPEG },
    );
    try {
      if (!converted.base64 || converted.base64.length > 1400000)
        throw Error("photoInvalid");
      const image = "data:image/jpeg;base64," + converted.base64;
      update("image", image);
      if (localPhotoReading) {
        setTexts((await readLocalPhoto(image)).filter(Boolean).slice(0, 40));
        setNotice(t("productPhotoReview"));
      } else setNotice(t("photoLocalUnavailable"));
    } finally {
      try {
        new File(converted.uri).delete();
      } catch {}
    }
  }
  async function submit(next: boolean, add = false) {
    productPayload(draft.form);
    const pending = { ...draft, submitted: true };
    await repo.saveProductDraft(pending);
    setDraft(pending);
    let item: Item;
    try {
      item = await new ProductApi(shop).create(pending);
    } catch (e) {
      // A definite validation refusal can be corrected. Lost responses stay frozen
      // and retry the exact same request; never allocate a second item identity.
      if (e instanceof ApiError && [400, 403, 409, 422].includes(e.status)) {
        const editable = { ...pending, submitted: false };
        await repo.saveProductDraft(editable);
        setDraft(editable);
      }
      throw e;
    }
    // Creation must obtain a new signed catalogue before this item can be sold.
    // If download fails, retain the frozen request so retry checks the same save.
    const snapshot = await new ShopConnection(shop).catalogue();
    await repo.refreshCatalogue(snapshot.shop, snapshot.items);
    await repo.confirmProduct(shop, item, pending.id);
    setNotice(t("productConfirmed"));
    if (next) {
      setDraft(fresh());
      setReview(false);
      setMatches([]);
      setTexts([]);
      setScanner(true);
    } else await saved(item, add);
  }
  if (!loaded) return <ActivityIndicator color={c.accent} />;
  if (picker) {
    const key = {
      categories: "categoryId",
      suppliers: "supplierId",
      taxes: "taxId",
      units: "unit",
    }[picker] as keyof ProductForm;
    return (
      <View style={s.root}>
        {button(t("back"), "arrow-left", () => setPicker(null))}
        <Text accessibilityRole="header" style={[s.title, { color: c.ink }]}>
          {t(
            picker === "taxes"
              ? "tax"
              : picker === "units"
                ? "productUnit"
                : picker,
          )}
        </Text>
        <TextInput
          accessibilityLabel={t("search")}
          placeholder={t("search")}
          value={query}
          onChangeText={setQuery}
          style={[s.input, { borderColor: c.line, color: c.ink }]}
        />
        {button(t("none"), "minus", () => {
          update(key, "");
          setPicker(null);
        })}
        {options?.[picker]
          .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
          .map((r) => (
            <View key={r.id}>
              {button(r.name, "chevron-right", () => {
                update(key, picker === "units" ? r.name : r.id);
                setPicker(null);
              })}
            </View>
          ))}
      </View>
    );
  }
  if (scanner)
    return (
      <View style={s.root}>
        {button(t("back"), "arrow-left", () => setScanner(false))}
        {permission?.granted ? (
          <CameraView
            style={{ height: 360 }}
            barcodeScannerSettings={{
              barcodeTypes: [
                "ean13",
                "ean8",
                "upc_a",
                "upc_e",
                "code128",
                "code39",
                "qr",
                "datamatrix",
              ],
            }}
            onBarcodeScanned={({ data }) => {
              if (!lock.current) void run(() => scan(data));
            }}
          />
        ) : (
          button(t("scan"), "maximize", () => void requestPermission())
        )}
      </View>
    );
  return (
    <View style={s.root}>
      <View style={s.row}>
        {button(
          t("back"),
          "arrow-left",
          () =>
            void run(async () => {
              if (review && !draft.submitted) {
                setReview(false);
                return;
              }
              await repo.saveProductDraft(draft);
              back();
            }),
        )}
        <Text accessibilityRole="header" style={[s.title, { color: c.ink }]}>
          {t(review ? "productReview" : "newItem")}
        </Text>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#a32a24" }}>
          {error}
        </Text>
      )}
      {!!notice && <Text style={{ color: c.muted }}>{notice}</Text>}
      {busy && <ActivityIndicator color={c.accent} />}
      {review ? (
        <>
          <View
            style={[
              s.card,
              { borderColor: c.line, backgroundColor: c.surface },
            ]}
          >
            <Text
              accessibilityRole="header"
              style={[s.title, { color: c.ink }]}
            >
              {draft.form.name}
            </Text>
            <Text style={{ color: c.muted }}>
              {draft.form.barcode} · {draft.form.unit}
            </Text>
            <Text style={{ color: c.ink }}>
              {t("price")}: {draft.form.price} {shop.currency}
            </Text>
            <Text style={{ color: c.ink }}>
              {t("productOpening")}:{" "}
              {draft.form.tracked ? draft.form.opening || "0" : t("none")}
            </Text>
            <Text style={{ color: c.muted }}>
              {t(draft.submitted ? "productSavePending" : "productOpeningHelp")}
            </Text>
          </View>
          {!draft.submitted &&
            button(t("edit"), "edit-2", () => setReview(false))}
          {button(
            t(draft.submitted ? "retry" : "save"),
            "check",
            () => void run(() => submit(false)),
            true,
          )}
          {button(
            t("productSaveNext"),
            "maximize",
            () => void run(() => submit(true)),
          )}
          {shop.permissions.sell &&
            draft.form.available &&
            button(
              t("productSaveSale"),
              "shopping-bag",
              () => void run(() => submit(false, true)),
            )}
        </>
      ) : (
        <>
          <View style={s.row}>
            {button(
              t("scan"),
              "maximize",
              () => setScanner(true),
              false,
              draft.submitted,
            )}
            {button(
              t("productPhoto"),
              "camera",
              () => void run(photo),
              false,
              draft.submitted,
            )}
          </View>
          {field("barcode", t("productBarcode"))}
          {button(
            t("productCheckBarcode"),
            "search",
            () => void run(() => scan(draft.form.barcode)),
            false,
            !draft.form.barcode || draft.submitted,
          )}
          {matches.map((item) => (
            <View key={item.id} style={[s.card, { borderColor: c.line }]}>
              <Text style={{ color: c.ink }}>
                {item.name} · {item.price / 100} {shop.currency}
              </Text>
              <Text style={{ color: c.muted }}>
                {t(item.active ? "availableForSale" : "productHidden")}
              </Text>
              {button(
                t("inventory"),
                "package",
                () =>
                  void run(async () => {
                    await repo.saveProductDraft(draft);
                    openInventory();
                  }),
              )}
            </View>
          ))}
          {!!draft.form.image && (
            <Image
              source={{ uri: draft.form.image }}
              style={{ height: 120, width: 120, borderRadius: 12 }}
            />
          )}
          {!!texts.length && (
            <View style={[s.card, { borderColor: c.line }]}>
              <Text style={{ color: c.muted }}>{t("productPhotoReview")}</Text>
              <View style={s.row}>
                {(["name", "brand", "sku"] as const).map((target) => (
                  <View key={target}>
                    {button(
                      t(
                        target === "name"
                          ? "name"
                          : target === "brand"
                            ? "productBrand"
                            : "productSku",
                      ),
                      "type",
                      () => setTextTarget(target),
                      textTarget === target,
                    )}
                  </View>
                ))}
              </View>
              {texts.map((text, i) => (
                <View key={i}>
                  {button(text, "type", () =>
                    update(
                      textTarget,
                      text.slice(
                        0,
                        textTarget === "name"
                          ? 160
                          : textTarget === "brand"
                            ? 100
                            : 80,
                      ),
                    ),
                  )}
                </View>
              ))}
            </View>
          )}
          {field("name", t("name"))}
          {field("price", t("price"), true)}
          {toggle("taxInclusive", t("productTaxIncluded"))}
          {(["categories", "suppliers", "taxes"] as const).map((kind) => {
            const key = {
              categories: "categoryId",
              suppliers: "supplierId",
              taxes: "taxId",
            }[kind] as keyof ProductForm;
            return (
              <View key={kind}>
                {button(
                  options?.[kind].find((r) => r.id === draft.form[key])?.name ||
                    t(kind === "taxes" ? "tax" : kind),
                  "chevron-down",
                  () => {
                    setQuery("");
                    setPicker(kind);
                  },
                  false,
                  !options || draft.submitted,
                )}
              </View>
            );
          })}
          {field("unit", t("productUnit"))}
          {!!options?.units.length &&
            button(t("productChooseUnit"), "list", () => {
              setQuery("");
              setPicker("units");
            })}
          {toggle("weighed", t("productFractional"))}
          {toggle("tracked", t("productTrackStock"))}
          {draft.form.tracked && (
            <>
              {field("opening", t("productOpening"), true)}
              <Text style={{ color: c.muted }}>{t("productOpeningHelp")}</Text>
            </>
          )}
          {field("cost", t("productCost"), true)}
          {field("mrp", t("productMrp"), true)}
          {field("brand", t("productBrand"))}
          {field("sku", t("productSku"))}
          {toggle("available", t("availableForSale"))}
          {button(
            t("productReview"),
            "check",
            () =>
              void run(async () => {
                productPayload(draft.form);
                await repo.saveProductDraft(draft);
                setReview(true);
              }),
            true,
            !!matches.length,
          )}
          {button(
            t("productKeepDraft"),
            "save",
            () =>
              void run(async () => {
                await repo.saveProductDraft(draft);
                setNotice(t("productOfflineDraft"));
              }),
          )}
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  root: { gap: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 25, fontWeight: "700", flexShrink: 1 },
  field: { gap: 7 },
  input: { borderWidth: 1, borderRadius: 16, padding: 15, fontSize: 17 },
  button: {
    minHeight: 48,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  card: { padding: 18, borderWidth: 1, borderRadius: 18, gap: 9 },
});
