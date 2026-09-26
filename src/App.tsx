import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as Localization from "expo-localization";
import QRCode from "react-native-qrcode-svg";
import { openStorage } from "./data/openStorage";
import { Repository } from "./data/repository";
import {
  formatMoney,
  normalizeDigits,
  parseMoney,
  quickCode,
  totals,
} from "./domain/money";
import { selectedAccount, upiUri } from "./domain/payments";
import type { Item, Locale, Sale, SessionData } from "./domain/types";
import { detectLocale, translator, translationCoverage } from "./i18n";
import { languages } from "./i18n/registry";
import { PosnicApi } from "./services/api";
import { SyncWorker } from "./services/sync";
import { parseServerInput } from "./services/serverAddress";
import { discoverServers, type DiscoveredServer } from "./services/discovery";
import { wifiAddress } from "./platform/wifi";
import * as Network from "expo-network";
import { printSale, printTest } from "./platform/printing";
import { vault } from "./platform/vault";
import { Brand } from "./components/Brand";
import { authorizeAccount } from "./services/accountAuthorization";

type Screen =
  | "sell"
  | "quick"
  | "cart"
  | "cash"
  | "upi"
  | "done"
  | "held"
  | "receipts"
  | "more"
  | "language"
  | "printer"
  | "devices"
  | "connection"
  | "customer"
  | "item"
  | "code"
  | "scanner"
  | "leaveTraining"
  | "pin";
type IconName = React.ComponentProps<typeof Feather>["name"];
const uuid = () => Crypto.randomUUID();

export default function App() {
  return (
    <SafeAreaProvider>
      <Till />
    </SafeAreaProvider>
  );
}

function Till() {
  const [localSetup, setLocalSetup] = useState(false);
  const [authorizationCode, setAuthorizationCode] = useState("");
  const accountRequest = useRef<AbortController | null>(null);
  const itemQueue = useRef<Item[]>([]);
  const addingItems = useRef(false);
  useEffect(() => () => accountRequest.current?.abort(), []);
  const dark = useColorScheme() === "dark",
    dimensions = useWindowDimensions();
  const palette = useMemo(
    () => ({
      paper: dark ? "#172331" : "#ffffff",
      ink: dark ? "#EDF3FA" : "#1D2D40",
      muted: dark ? "#ABBDCF" : "#596C82",
      line: dark ? "#304256" : "#DFE7F0",
      wash: dark ? "#101A26" : "#F3F6FA",
      accent: dark ? "#91BEF0" : "#2969AD",
      onAccent: dark ? "#102237" : "#ffffff",
      soft: dark ? "#243C57" : "#E8F1FC",
      danger: dark ? "#FFB5B5" : "#B32F3D",
    }),
    [dark],
  );
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [state, setState] = useState<SessionData | null>(null),
    [repo, setRepo] = useState<Repository | null>(null),
    [worker, setWorker] = useState<SyncWorker | null>(null);
  const [screen, setScreen] = useState<Screen>("sell"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [itemPage, setItemPage] = useState(0);

  const [locked, setLocked] = useState(false),
    [pinEnabled, setPinEnabled] = useState(false),
    [pin, setPin] = useState(""),
    [pinConfirm, setPinConfirm] = useState(""),
    [recovering, setRecovering] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootFailure, setBootFailure] = useState("");
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [cash, setCash] = useState(""),
    [code, setCode] = useState("");
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [itemPrice, setItemPrice] = useState(""),
    [itemCode, setItemCode] = useState(""),
    [itemVisual, setItemVisual] = useState("📦");
  const [server, setServer] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [focusedField, setFocusedField] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundServers, setFoundServers] = useState<DiscoveredServer[]>([]);
  const [searchProgress, setSearchProgress] = useState(0);
  const discovery = useRef<AbortController | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncLock = useRef(false);
  const [connectionError, setConnectionError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const unlockAttempt = useRef(0);
  const [accountId, setAccountId] = useState<string | undefined>(),
    [checked, setChecked] = useState(false),
    [reference, setReference] = useState(""),
    [selectedSale, setLastSale] = useState<Sale | null>(null);
  const lastSale =
    state?.sales.find((sale) => sale.id === selectedSale?.id) ?? selectedSale;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannerHandled = useRef(false),
    actionLock = useRef(false);
  const locale = state?.settings.locale ?? "en",
    t = useMemo(() => translator(locale), [locale]);
  const rtl = languages.find((l) => l.code === locale)?.rtl ?? false;
  const shop = state?.shop;
  const currency = shop?.currency ?? "INR";
  const money = (value: number) => formatMoney(value, currency, locale);
  const sum = totals(state?.cart.lines ?? []);
  const account = shop ? selectedAccount(shop, accountId) : null;
  const refresh = useCallback(async () => {
    if (repo) setState(await repo.load());
  }, [repo]);
  useEffect(() => setItemPage(0), [query, category]);
  const go = (next: Screen) => {
    setError("");
    setNotice("");
    if (next === "scanner") scannerHandled.current = false;
    if (next === "cash") setCash("");
    if (next === "upi") {
      setAccountId(undefined);
      setChecked(false);
      setReference("");
    }
    setScreen(next);
  };

  useEffect(() => {
    let active = true;
    let stage = "STARTUP-CREDENTIALS";
    (async () => {
      setBootFailure("");
      setError("");
      const enabled = await vault.hasPin();
      setPinEnabled(enabled);
      const profile = await vault.profile();
      if (profile) {
        setServer(profile.server);
        setUsername(profile.username);
      }
      const account = await vault.account();
      if (enabled && !account) {
        setLocked(true);
        return;
      }
      if (account) {
        setPassword(account.password);
      }
      setLocked(false);
      stage = "STARTUP-DB";
      const storage = await openStorage();
      const repository = new Repository(storage, uuid);
      stage = "STARTUP-SETTINGS";
      if (!(await storage.get("settings")))
        await repository.settings({
          locale: detectLocale(
            Localization.getLocales()[0]?.languageTag ?? "en",
          ),
          printer: "system",
          autoPrint: false,
        });
      stage = "STARTUP-RECORDS";
      const data = await repository.load();
      if (active) {
        setRepo(repository);
        setWorker(new SyncWorker(repository));
        setState(data);
      }
    })().catch((e) => {
      if (active) {
        setBootFailure(stage);
        setError(
          e instanceof Error && e.message === "nativeBuildRequired"
            ? e.message
            : "storageUnavailable",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [bootAttempt]);
  const syncNow = useCallback(
    async (force = false) => {
      if (!worker || !repo || locked || syncLock.current) return;
      syncLock.current = true;
      setSyncing(true);
      try {
        await worker.run(force);
        setConnectionError(worker.lastError || "");
      } catch (e) {
        setConnectionError(e instanceof Error ? e.message : "networkError");
      } finally {
        // A failed catalogue refresh must not hide orders already acknowledged.
        try {
          setState(await repo.load());
        } finally {
          syncLock.current = false;
          setSyncing(false);
        }
      }
    },
    [worker, repo, locked],
  );
  useEffect(() => {
    if (!worker || !repo || locked) return;
    void syncNow();
    const timer = setInterval(() => void syncNow(), 30000);
    const listener = AppState.addEventListener("change", (value) => {
      if (value === "active") void syncNow(true);
    });
    const network = Network.addNetworkStateListener((value) => {
      if (value.isConnected) void syncNow(true);
    });
    return () => {
      clearInterval(timer);
      listener.remove();
      network.remove();
    };
  }, [worker, repo, syncNow]);
  useEffect(() => () => discovery.current?.abort(), []);

  function acceptServer(value: string) {
    const details = parseServerInput(value);
    setServer(details.address);
    if (details.code) {
      setPairCode(details.code);
      setPairing(true);
    }
    discovery.current?.abort();
  }
  async function searchWifi() {
    if (discovery.current) {
      discovery.current.abort();
      return;
    }
    const controller = new AbortController();
    discovery.current = controller;
    setSearching(true);
    setFoundServers([]);
    setSearchProgress(0);
    setError("");
    let found = false;
    try {
      const ip = await wifiAddress();
      await discoverServers(
        ip,
        controller.signal,
        (hit) => {
          found = true;
          setFoundServers((rows) =>
            rows.some((row) => row.address === hit.address)
              ? rows
              : [...rows, hit],
          );
        },
        (done, total) => setSearchProgress(Math.round((done / total) * 100)),
      );
      if (!controller.signal.aborted && !found) setError("wifiNotFound");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "networkError");
    } finally {
      discovery.current = null;
      setSearching(false);
    }
  }

  const lock = () => {
    accountRequest.current?.abort();
    discovery.current?.abort();
    unlockAttempt.current++;
    setUnlocking(false);
    vault.lock();
    setLocked(true);
    setPin("");
    setPassword("");
    setRecovering(false);
    setError("");
  };
  async function unlockSession() {
    const attempt = ++unlockAttempt.current;
    setUnlocking(true);
    setError("");
    const timeout = setTimeout(() => {
      if (attempt !== unlockAttempt.current) return;
      unlockAttempt.current++;
      vault.lock();
      setUnlocking(false);
      setError("pinTimeout");
    }, 21000);
    try {
      await vault.unlock(pin);
      if (attempt !== unlockAttempt.current) return;
      setPin("");
      setLocked(false);
      // A warm resume already owns an open database and worker. Do not rebuild
      // those or wait for a network sync to unlock the checkout.
      if (!repo) setBootAttempt((n) => n + 1);
    } catch (e) {
      if (attempt === unlockAttempt.current)
        setError(e instanceof Error ? e.message : "pinWrong");
    } finally {
      clearTimeout(timeout);
      if (attempt === unlockAttempt.current) setUnlocking(false);
    }
  }
  async function signOut() {
    if (syncLock.current) {
      setError("signOutSyncing");
      return;
    }
    syncLock.current = true;
    unlockAttempt.current++;
    if (locked) vault.lock();
    setUnlocking(false);
    setBusy(true);
    try {
      const repository = repo ?? new Repository(await openStorage(), uuid);
      await repository.signOut();
      await vault.clear();
      setWorker(null);
      setRepo(null);
      setState(null);
      setPassword("");
      setUsername("");
      setServer("");
      setPin("");
      setPinEnabled(false);
      setLocked(false);
      setRecovering(false);
      setConfirmSignOut(false);
      setLocalSetup(false);
      setBootAttempt((n) => n + 1);
      go("sell");
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknownError");
      setConfirmSignOut(false);
    } finally {
      syncLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!pinEnabled) return;
    if (AppState.currentState === "background") lock();
    const listener = AppState.addEventListener("change", (value) => {
      if (value === "background") lock();
    });
    return () => listener.remove();
  }, [pinEnabled]);
  async function run(fn: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknownError");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function addItem(item: Item) {
    if (actionLock.current && !addingItems.current) return;
    itemQueue.current.push(item);
    if (addingItems.current) return;
    addingItems.current = true;
    try {
      while (itemQueue.current.length) {
        const next = itemQueue.current.shift()!;
        await run(async () => {
          await repo!.addItem(next);
        });
      }
    } finally {
      addingItems.current = false;
    }
  }
  async function finish(method: "cash" | "upi") {
    await run(async () => {
      if (!state || !repo || !shop) return;
      const payment =
        method === "cash"
          ? {
              method: "cash" as const,
              received: cash ? parseMoney(cash) : sum.total,
              change: 0,
            }
          : {
              method: "upi" as const,
              account: account!,
              status: "staff-confirmed" as const,
              reference,
            };
      if (method === "upi" && (!checked || !account))
        throw new Error("upiUnavailable");
      const sale = await repo.checkout(state.cart.id, payment);
      setLastSale(sale);
      setScreen("done");
      setAmount("");
      setNote("");
      if (state.settings.autoPrint && state.settings.printer === "system") {
        try {
          await printSale(sale, shop, state.settings, t);
        } catch {
          setNotice("printUnknown");
        }
      }
      void syncNow(true);
    });
  }
  const icon = (glyph: IconName, size = 20) => (
    <Feather name={glyph} size={size} color={palette.ink} />
  );
  const button = (
    label: string,
    onPress: () => void,
    primary = false,
    disabled = false,
    testID?: string,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={(busy && !locked) || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primary,
        ((busy && !locked) || disabled) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.onAccent]}>
        {label}
      </Text>
    </Pressable>
  );
  const iconButton = (glyph: IconName, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      {icon(glyph)}
    </Pressable>
  );
  const field = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    options: {
      numeric?: boolean;
      secret?: boolean;
      phone?: boolean;
      testID?: string;
      placeholder?: string;
    } = {},
  ) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={options.testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={options.secret}
        keyboardType={
          options.numeric
            ? "decimal-pad"
            : options.phone
              ? "phone-pad"
              : "default"
        }
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={options.placeholder}
        placeholderTextColor={palette.muted}
        onFocus={() => setFocusedField(label)}
        onBlur={() => setFocusedField("")}
        style={[styles.input, focusedField === label && styles.inputFocused]}
      />
    </View>
  );
  const heading = (text: string) => (
    <Text accessibilityRole="header" style={styles.heading}>
      {text}
    </Text>
  );
  const help = (text: string) => <Text style={styles.help}>{text}</Text>;
  const message = (text: string) => (
    <View style={styles.message}>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
  const row = (label: string, value: string) => (
    <View style={styles.row}>
      <Text style={styles.body}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
  const back = (target: Screen = "sell") => (
    <View style={styles.back}>
      {iconButton("arrow-left", t("back"), () => go(target))}
    </View>
  );
  const menu = (
    glyph: IconName,
    label: string,
    target: Screen,
    detail?: string,
  ) => (
    <Pressable
      key={target}
      accessibilityRole="button"
      onPress={() => go(target)}
      style={styles.menu}
    >
      {icon(glyph)}
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{label}</Text>
        {detail && <Text style={styles.small}>{detail}</Text>}
      </View>
      {icon("chevron-right", 17)}
    </Pressable>
  );
  const keypad = (
    value: string,
    onChange: (s: string) => void,
    moneyPad: boolean,
  ) => (
    <View style={styles.keypad}>
      {[
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        moneyPad ? "." : "clear",
        "0",
        "delete",
      ].map((key) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={
            key === "delete" ? t("remove") : key === "clear" ? t("clear") : key
          }
          style={({ pressed }) => [styles.key, pressed && styles.pressed]}
          onPress={() => {
            if (key === "delete") onChange(value.slice(0, -1));
            else if (key === "clear") onChange("");
            else if (key === "." && !value.includes("."))
              onChange((value || "0") + ".");
            else if (
              key !== "." &&
              value.length < (moneyPad ? 12 : 6) &&
              (!moneyPad ||
                !value.includes(".") ||
                (value.split(".")[1]?.length ?? 0) < 2)
            )
              onChange(value + key);
          }}
        >
          {key === "delete" ? (
            icon("delete", 24)
          ) : (
            <Text style={styles.keyText}>
              {key === "clear" ? t("clear") : key}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
  const cartView = () => (
    <>
      {state!.cart.lines.map((line) => (
        <View key={line.id} style={styles.cartLine}>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>{line.name}</Text>
            <Text style={styles.small}>{money(line.price)}</Text>
          </View>
          <View style={styles.quantity}>
            {iconButton(
              "minus",
              t("remove") + " " + line.name,
              () => void run(() => repo!.quantity(line.id, -1)),
            )}
            <Text style={styles.value}>{line.quantity}</Text>
            {iconButton(
              "plus",
              t("addOne") + " " + line.name,
              () => void run(() => repo!.quantity(line.id, 1)),
            )}
          </View>
        </View>
      ))}
      {row(t("total"), money(sum.total))}
      {sum.tax > 0 && row(t("tax"), money(sum.tax))}
    </>
  );

  function content() {
    if (confirmSignOut)
      return (
        <>
          {heading(t("switchUser"))}
          {help(t("signOutHelp"))}
          {error && help(t(error))}
          {button(t("signOut"), () => void signOut(), true, busy)}
          {button(t("cancel"), () => setConfirmSignOut(false), false, busy)}
        </>
      );
    if (locked)
      return (
        <>
          {heading(t(recovering ? "passwordRecovery" : "unlock"))}
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: palette.soft,
              borderRadius: 16,
              padding: 14,
              marginBottom: 12,
            }}
          >
            {icon("lock", 24)}
          </View>
          {help(username || t("pinHelp"))}
          {error && (
            <Text accessibilityRole="alert" style={styles.body}>
              {t(error)}
            </Text>
          )}
          {recovering ? (
            <>
              {field(t("username"), username, setUsername)}
              {field(t("password"), password, setPassword, { secret: true })}
              {button(
                t("signIn"),
                () =>
                  void run(async () => {
                    const attempt = ++unlockAttempt.current;
                    const storage = await openStorage();
                    const saved = await new Repository(storage, uuid).load();
                    if (
                      !saved.shop ||
                      saved.shop.mode === "training" ||
                      !saved.shop.baseUrl
                    )
                      throw new Error("pinTrainingRecovery");
                    const data = await new PosnicApi(
                      saved.shop.baseUrl,
                    ).connect(username, password, undefined, false);
                    if (attempt !== unlockAttempt.current) return;
                    if (
                      data.shop.id !== saved.shop.id ||
                      data.shop.branchId !== saved.shop.branchId ||
                      data.shop.staffId !== saved.shop.staffId
                    )
                      throw new Error("permissionDenied");
                    await vault.recover({
                      token: data.token,
                      username,
                      password,
                      server: saved.shop.baseUrl,
                    });
                    setPinEnabled(false);
                    setLocked(false);
                    setRecovering(false);
                    setBootAttempt((n) => n + 1);
                    go("pin");
                  }),
                true,
                busy || !username || !password,
              )}
              {button(t("back"), () => {
                unlockAttempt.current++;
                setRecovering(false);
                setError("");
              })}
            </>
          ) : (
            <>
              {field(
                t("pin"),
                pin,
                (value) =>
                  setPin(normalizeDigits(value).replace(/\D/g, "").slice(0, 6)),
                { numeric: true, secret: true },
              )}
              {button(
                t("unlock"),
                () => void unlockSession(),
                true,
                pin.length < 4 || unlocking,
              )}
              {unlocking && (
                <>
                  {help(t("unlocking"))}
                  {button(t("cancel"), lock)}
                </>
              )}
              {button(t("passwordRecovery"), () => {
                unlockAttempt.current++;
                vault.lock();
                setUnlocking(false);
                setRecovering(true);
                setError("");
              })}
            </>
          )}
          {button(t("switchUser"), () => setConfirmSignOut(true))}
        </>
      );

    if (!state || !repo)
      return (
        <View style={styles.loading}>
          {bootFailure ? (
            <>
              <Text accessibilityRole="alert" style={styles.body}>
                {t(error || "storageUnavailable")}
              </Text>
              {help(bootFailure)}
              {button(
                t("retry"),
                () => setBootAttempt((attempt) => attempt + 1),
                true,
              )}
            </>
          ) : (
            <>
              <ActivityIndicator color={palette.accent} />
              {help(t("loading"))}
            </>
          )}
        </View>
      );
    if (!shop && screen !== "scanner" && screen !== "language")
      return (
        <>
          <View style={styles.intro}>
            <View style={styles.introIcon}>{icon("shopping-bag", 26)}</View>
            {heading(t("welcome"))}
            {help(t("connectHelp"))}
          </View>
          {!localSetup ? (
            <View style={styles.setupCard}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                {icon("cloud", 18)}
                <Text style={styles.fieldLabel}>{t("cloudAccount")}</Text>
              </View>
              {help(t("accountConnectHelp"))}
              {(["login", "signup"] as const).map((intent) => (
                <React.Fragment key={intent}>
                  {button(
                    t(intent === "login" ? "signIn" : "createAccount"),
                    () =>
                      void run(async () => {
                        const controller = new AbortController();
                        accountRequest.current = controller;
                        try {
                          const grant = await authorizeAccount(
                            intent,
                            async (url, code) => {
                              setAuthorizationCode(code);
                              await Linking.openURL(url);
                            },
                            controller.signal,
                          );
                          const data = await new PosnicApi(
                            grant.baseUrl,
                          ).connect("", "", grant.code, true, grant.verifier);
                          await repo.pair(data.shop, data.items);
                          await vault.remember({
                            token: data.token,
                            username: data.shop.staffName,
                            password: "",
                            server: grant.baseUrl,
                          });
                          setPin("");
                          setPinConfirm("");
                          go("pin");
                        } finally {
                          setAuthorizationCode("");
                          accountRequest.current = null;
                        }
                      }),
                    intent === "login",
                  )}
                </React.Fragment>
              ))}
              {!!authorizationCode && (
                <>
                  {help(t("authorizeInBrowser") + " " + authorizationCode)}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => accountRequest.current?.abort()}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>{t("cancel")}</Text>
                  </Pressable>
                </>
              )}
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: palette.line,
                  paddingTop: 18,
                  marginTop: 12,
                }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  {icon("server", 18)}
                  <Text style={styles.fieldLabel}>{t("selfHosted")}</Text>
                </View>
                {help(t("selfHostedHelp"))}
                {button(t("connectLocalShop"), () => setLocalSetup(true))}
              </View>
            </View>
          ) : (
            <View style={styles.setupCard}>
              {button(t("backToAccount"), () => setLocalSetup(false))}
              <Text style={styles.fieldLabel}>{t("server")}</Text>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <TextInput
                  accessibilityLabel={t("server")}
                  testID="server-input"
                  value={server}
                  onChangeText={(value) => {
                    setServer(value);
                    try {
                      const details = parseServerInput(value);
                      if (details.code) {
                        setPairing(true);
                        setPairCode(details.code);
                      }
                    } catch {}
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t("serverPlaceholder")}
                  placeholderTextColor={palette.muted}
                  style={[styles.input, { flex: 1, minWidth: 0 }]}
                />
              </View>
              <View style={styles.connectionTools}>
                {iconButton(
                  searching ? "x" : "wifi",
                  t(searching ? "stopSearch" : "searchWifi"),
                  () => void searchWifi(),
                )}
                {iconButton("maximize", t("shopQr"), () => {
                  discovery.current?.abort();
                  go("scanner");
                })}
                {iconButton("key", t("pairCode"), () =>
                  setPairing((value) => !value),
                )}
              </View>
              {help(t("wifiFirst"))}
              {searching && (
                <Text accessibilityLiveRegion="polite" style={styles.small}>
                  {t("searchingWifi")} {searchProgress}%
                </Text>
              )}
              {foundServers.map((hit) => (
                <View key={hit.address}>
                  {button(
                    hit.address +
                      (hit.compatible ? "" : " · " + t("serverUpgrade")),
                    () => acceptServer(hit.address),
                    false,
                    !hit.compatible,
                  )}
                </View>
              ))}
              {pairing ? (
                <>
                  {field(t("pairCode"), pairCode, setPairCode)}
                  {help(t("pairHelp"))}
                </>
              ) : (
                <>
                  {field(t("username"), username, setUsername)}
                  {field(t("password"), password, setPassword, {
                    secret: true,
                  })}
                  {help(t("rememberHelp"))}
                </>
              )}
              {button(
                t(pairing ? "pair" : "signIn"),
                () =>
                  void run(async () => {
                    const details = parseServerInput(server);
                    const data = await new PosnicApi(details.address).connect(
                      username,
                      password,
                      details.code || (pairing ? pairCode.trim() : undefined),
                    );
                    await repo.pair(data.shop, data.items);
                    await vault.remember({
                      token: data.token,
                      username: pairing ? data.shop.staffName : username,
                      password: pairing ? "" : password,
                      server: details.address,
                    });
                    setPairCode("");
                    setPin("");
                    setPinConfirm("");
                    go("pin");
                  }),
                true,
                !server ||
                  (pairing ? !pairCode.trim() : !username || !password),
              )}
            </View>
          )}
          {button(
            t("trainingStart"),
            () =>
              void run(async () => {
                await repo.startTraining();
                go("sell");
              }),
            false,
            false,
            "start-training",
          )}
          {help(t("trainingHelp"))}
        </>
      );
    if (screen === "language")
      return (
        <>
          {back(shop ? "more" : "sell")}
          {heading(t("language"))}
          {help(t("fontReview"))}
          {languages.map((language) => (
            <Pressable
              accessibilityRole="radio"
              aria-checked={locale === language.code}
              accessibilityState={{ checked: locale === language.code }}
              key={language.code}
              style={styles.menu}
              onPress={() =>
                void run(() =>
                  repo.settings({ ...state.settings, locale: language.code }),
                )
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>
                  {language.name}
                  {language.beta ? " · " + t("beta") : ""}
                </Text>
                {language.code !== "en" && (
                  <Text style={styles.small}>
                    {t("languageCoverage")}:{" "}
                    {translationCoverage(language.code).translated}/
                    {translationCoverage(language.code).total}
                  </Text>
                )}
              </View>
              {locale === language.code ? icon("check") : null}
            </Pressable>
          ))}
        </>
      );
    if (screen === "scanner")
      return (
        <>
          {back(shop ? "sell" : "sell")}
          {heading(t(shop ? "scan" : "shopQr"))}
          {!cameraPermission?.granted ? (
            <>
              {help(t("cameraPermission"))}
              {button(
                t("allowCamera"),
                () => void requestCameraPermission(),
                true,
              )}
            </>
          ) : (
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  "qr",
                  "ean13",
                  "ean8",
                  "code128",
                  "code39",
                  "upc_a",
                  "upc_e",
                ],
              }}
              onBarcodeScanned={({ data }) => {
                if (scannerHandled.current) return;
                scannerHandled.current = true;
                if (!shop) {
                  try {
                    acceptServer(data);
                    go("sell");
                  } catch (e) {
                    setError("invalidServer");
                    scannerHandled.current = false;
                  }
                } else {
                  const matches = state.items.filter(
                    (i) => i.barcode === data && i.active,
                  );
                  if (matches.length === 1) {
                    void addItem(matches[0]!);
                    go("sell");
                  } else {
                    go("sell");
                    setQuery(data);
                    setError(matches.length ? "multipleMatches" : "noMatch");
                  }
                }
              }}
            />
          )}
        </>
      );
    if (!shop) return null;
    switch (screen) {
      case "sell":
      case "quick": {
        const shown = state.items.filter(
          (item) =>
            item.active &&
            (!category || item.category === category) &&
            (!query ||
              item.name
                .toLocaleLowerCase(locale)
                .includes(query.toLocaleLowerCase(locale)) ||
              item.code === normalizeDigits(query) ||
              item.barcode === query),
        );
        const columns =
          dimensions.width < 365 ? 2 : dimensions.width > 700 ? 4 : 3;
        return (
          <>
            <View style={styles.segments}>
              {(["sell", "quick"] as const).map((tab) => (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  aria-selected={screen === tab}
                  accessibilityState={{ selected: screen === tab }}
                  onPress={() => go(tab)}
                  style={[
                    styles.segment,
                    screen === tab && styles.segmentActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      screen === tab && { color: palette.accent },
                    ]}
                  >
                    {t(tab === "sell" ? "items" : "quick")}
                  </Text>
                </Pressable>
              ))}
            </View>
            {screen === "sell" ? (
              <>
                <View style={styles.searchRow}>
                  <TextInput
                    accessibilityLabel={t("search")}
                    placeholder={t("search")}
                    placeholderTextColor={palette.muted}
                    value={query}
                    onChangeText={setQuery}
                    style={[styles.input, { flex: 1, margin: 0 }]}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      if (query) {
                        const exact = state.items.filter(
                          (i) => i.active && i.code === normalizeDigits(query),
                        );
                        if (exact.length === 1) {
                          void addItem(exact[0]!);
                          setQuery("");
                        } else if (exact.length > 1)
                          setError("multipleMatches");
                      }
                    }}
                  />
                  {iconButton("grid", t("code"), () => go("code"))}
                  {iconButton("maximize", t("scan"), () => go("scanner"))}
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categories}
                >
                  {["", ...new Set(state.items.map((i) => i.category))].map(
                    (cat) => (
                      <Pressable
                        key={cat}
                        onPress={() => setCategory(cat)}
                        accessibilityRole="button"
                        aria-selected={category === cat}
                        accessibilityState={{ selected: category === cat }}
                        style={[
                          styles.chip,
                          category === cat && styles.chipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.small,
                            category === cat && { color: palette.accent },
                          ]}
                        >
                          {cat || t("all")}
                        </Text>
                      </Pressable>
                    ),
                  )}
                </ScrollView>
                <FlatList
                  scrollEnabled={false}
                  key={columns}
                  numColumns={columns}
                  data={shown.slice(itemPage * 48, (itemPage + 1) * 48)}
                  keyExtractor={(item) => item.id}
                  columnWrapperStyle={{ gap: 8 }}
                  contentContainerStyle={{ gap: 8 }}
                  ListEmptyComponent={help(t("noMatch"))}
                  renderItem={({ item }) => (
                    <Pressable
                      testID={"item-" + item.id}
                      accessibilityRole="button"
                      accessibilityLabel={item.name + " " + money(item.price)}
                      onPress={() => void addItem(item)}
                      style={({ pressed }) => [
                        styles.tile,
                        { maxWidth: `${100 / columns - 1.5}%` },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.art,
                          item.shape === "circle" && { borderRadius: 40 },
                          item.shape === "diamond" && { borderRadius: 12 },
                        ]}
                      >
                        {item.image ? (
                          <Image
                            source={{ uri: item.image }}
                            style={{ width: "100%", height: "100%" }}
                            resizeMode="cover"
                          />
                        ) : (
                          <Text style={{ fontSize: 25 }}>
                            {item.visual || "📦"}
                          </Text>
                        )}
                      </View>
                      {state.cart.lines.some(
                        (line) => line.itemId === item.id,
                      ) && (
                        <View style={styles.itemCount}>
                          <Text style={styles.itemCountText}>
                            {state.cart.lines
                              .filter((line) => line.itemId === item.id)
                              .reduce(
                                (count, line) => count + line.quantity,
                                0,
                              )}
                          </Text>
                        </View>
                      )}
                      <View style={styles.tileLabel}>
                        <Text style={styles.itemName} numberOfLines={2}>
                          {item.name}
                        </Text>
                        <Text style={styles.itemPrice}>
                          {money(item.price)}
                        </Text>
                      </View>
                    </Pressable>
                  )}
                />
                {shown.length > 48 && (
                  <View style={styles.row}>
                    {iconButton("chevron-left", t("back"), () =>
                      setItemPage(Math.max(0, itemPage - 1)),
                    )}
                    <Text style={styles.small}>
                      {itemPage + 1} / {Math.ceil(shown.length / 48)}
                    </Text>
                    {iconButton("chevron-right", t("more"), () =>
                      setItemPage(
                        Math.min(
                          Math.ceil(shown.length / 48) - 1,
                          itemPage + 1,
                        ),
                      ),
                    )}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.amount}>
                  {amount ? money(safeAmount(amount)) : money(0)}
                </Text>
                {field(t("description") + " · " + t("optional"), note, setNote)}
                {keypad(amount, setAmount, true)}
                {button(
                  t("add"),
                  () =>
                    void run(async () => {
                      await repo.addQuick(
                        parseMoney(amount),
                        note || t("quickSale"),
                      );
                      setAmount("");
                      setNote("");
                      go("cart");
                    }),
                  true,
                  !amount ||
                    safeAmount(amount) <= 0 ||
                    !shop.permissions.quickSale,
                )}
              </>
            )}
          </>
        );
      }
      case "code": {
        const matches = state.items.filter(
          (i) => i.active && i.code === normalizeDigits(code),
        );
        return (
          <>
            {back()}
            {field(
              t("quickCode"),
              code,
              (s) => setCode(normalizeDigits(s).slice(0, 6)),
              { numeric: true },
            )}
            {help(t("codeHelp"))}
            {matches.length === 1
              ? message(matches[0]!.name + " · " + money(matches[0]!.price))
              : code
                ? message(t(matches.length ? "multipleMatches" : "noMatch"))
                : null}
            {keypad(code, setCode, false)}
            {matches.length > 1
              ? matches.map((i) => button(i.name, () => void addItem(i)))
              : button(
                  t("add"),
                  () =>
                    void run(async () => {
                      await repo.addItem(matches[0]!);
                      setCode("");
                      go("sell");
                    }),
                  true,
                  matches.length !== 1,
                )}
          </>
        );
      }
      case "cart":
        return (
          <>
            {back()}
            {shop.permissions.customerWrite &&
              button(
                state.cart.customer?.name ||
                  state.cart.customer?.phone ||
                  "+ " + t("addCustomer"),
                () => {
                  setName("");
                  setPhone("");
                  go("customer");
                },
              )}
            {cartView()}
            {button(
              t("cash") + " · " + money(sum.total),
              () => go("cash"),
              true,
              !state.cart.lines.length || sum.total <= 0,
            )}
            {button(
              t("upi"),
              () => go("upi"),
              false,
              !state.cart.lines.length ||
                !shop.upiAccounts.some((a) => a.active),
            )}
            {button(
              t("hold"),
              () =>
                void run(async () => {
                  await repo.hold();
                  go("held");
                }),
              false,
              !state.cart.lines.length,
            )}
          </>
        );
      case "cash":
        return (
          <>
            {back("cart")}
            <Text style={styles.amount}>{money(sum.total)}</Text>
            {field(t("cashReceived"), cash, setCash, {
              numeric: true,
              placeholder: (sum.total / 100).toFixed(2),
              testID: "cash-received",
            })}
            <View style={styles.categories}>
              {[
                sum.total,
                ...[10000, 20000, 50000, 100000]
                  .filter((n) => n > sum.total)
                  .slice(0, 2),
              ].map((value) => (
                <Pressable
                  key={value}
                  style={styles.chip}
                  onPress={() => setCash((value / 100).toFixed(2))}
                >
                  <Text style={styles.body}>
                    {value === sum.total ? t("exact") : money(value)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {row(
              t("change"),
              money(
                Math.max(0, (cash ? safeAmount(cash) : sum.total) - sum.total),
              ),
            )}
            {help(t("savedLocally"))}
            {button(
              t("done") + " · " + t("cashReceived"),
              () => void finish("cash"),
              true,
              (cash ? safeAmount(cash) : sum.total) < sum.total,
              "finish-cash",
            )}
          </>
        );
      case "upi": {
        let uri = "";
        if (account) {
          try {
            uri = upiUri(account, sum.total, currency, state.cart.id);
          } catch {}
        }
        return (
          <>
            {back("cart")}
            <Text style={styles.amount}>{money(sum.total)}</Text>
            {!account ? (
              message(t("noUpi"))
            ) : (
              <>
                {heading(t("account"))}
                {shop.upiAccounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <Pressable
                      key={a.id}
                      accessibilityRole="radio"
                      aria-checked={account.id === a.id}
                      accessibilityState={{ checked: account.id === a.id }}
                      style={styles.menu}
                      onPress={() => {
                        setAccountId(a.id);
                        setChecked(false);
                        setReference("");
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.body}>
                          {a.name}
                          {a.id === shop.defaultUpiAccountId
                            ? " · " + t("default")
                            : ""}
                        </Text>
                        <Text
                          style={[styles.small, { writingDirection: "ltr" }]}
                        >
                          {a.vpa}
                        </Text>
                      </View>
                      {account.id === a.id ? icon("check") : null}
                    </Pressable>
                  ))}
                {account.verification === "provider" ? (
                  message(t("providerRequired"))
                ) : uri ? (
                  <>
                    <View style={styles.qr}>
                      <QRCode value={uri} size={210} />
                    </View>
                    {help(t("manualPayment"))}
                    {field(
                      t("reference") + " · " + t("optional"),
                      reference,
                      setReference,
                    )}
                    <View style={styles.row}>
                      <Text style={[styles.body, { flex: 1 }]}>
                        {t("confirmPayment")}
                      </Text>
                      <Switch
                        accessibilityLabel={t("confirmPayment")}
                        value={checked}
                        onValueChange={setChecked}
                      />
                    </View>
                    {button(
                      t("recordPayment"),
                      () => void finish("upi"),
                      true,
                      !checked || !shop.permissions.manualUpi,
                    )}
                  </>
                ) : (
                  message(t("upiUnavailable"))
                )}
              </>
            )}
          </>
        );
      }
      case "done":
        return (
          <>
            {lastSale ? (
              <>
                <View style={styles.success}>{icon("check", 36)}</View>
                {heading(t("saved"))}
                <Text style={styles.amount}>{money(lastSale.total)}</Text>
                {message(
                  t(
                    lastSale.training
                      ? "training"
                      : lastSale.sync === "synced"
                        ? "synced"
                        : "savedLocally",
                  ),
                )}
                {help(lastSale.receipt)}
                {button(
                  t("newSale"),
                  () => {
                    setLastSale(null);
                    go("sell");
                  },
                  true,
                  false,
                  "new-sale",
                )}
                {button(
                  t("print"),
                  () =>
                    void run(async () => {
                      if (state.settings.printer === "till") {
                        await repo.queueTillPrint(lastSale.id);
                        setNotice("printQueued");
                        void syncNow(true);
                      } else {
                        await printSale(lastSale, shop, state.settings, t);
                        setNotice("printed");
                      }
                    }),
                )}
              </>
            ) : (
              button(t("newSale"), () => go("sell"), true)
            )}
          </>
        );
      case "held":
        return (
          <>
            {heading(t("held"))}
            {!state.held.length && help(t("noHeld"))}
            {state.held.map((cart) => (
              <Pressable
                key={cart.id}
                style={styles.menu}
                onPress={() =>
                  void run(async () => {
                    await repo.resume(cart.id);
                    go("cart");
                  })
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>
                    {cart.customer?.name || t("heldAt")}
                  </Text>
                  <Text style={styles.small}>
                    {new Date(cart.createdAt).toLocaleTimeString(locale)} ·{" "}
                    {cart.lines.length} {t("items")}
                  </Text>
                </View>
                <Text style={styles.value}>
                  {money(totals(cart.lines).total)}
                </Text>
                {icon("chevron-right")}
              </Pressable>
            ))}
          </>
        );
      case "receipts":
        return (
          <>
            {heading(t("receipts"))}
            {button(t("refresh"), () => void syncNow(true), false, syncing)}
            {!state.sales.length && help(t("noReceipts"))}
            {state.sales.map((sale) => (
              <Pressable
                key={sale.id}
                style={[
                  styles.menu,
                  sale.sync === "pending" && {
                    backgroundColor: palette.wash,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                  },
                ]}
                onPress={() => {
                  setLastSale(sale);
                  go("done");
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>{sale.receipt}</Text>
                  <Text style={styles.small}>
                    {t(sale.training ? "training" : sale.sync)} ·{" "}
                    {t(sale.payment.method)}
                  </Text>
                </View>
                <Text style={styles.value}>{money(sale.total)}</Text>
                {icon("chevron-right")}
              </Pressable>
            ))}
          </>
        );
      case "customer":
        return (
          <>
            {back("cart")}
            {heading(t("addCustomer"))}
            {field(t("name"), name, setName)}
            {field(t("phone") + " · " + t("optional"), phone, setPhone, {
              phone: true,
            })}
            {button(
              t("save"),
              () =>
                void run(async () => {
                  await repo.customer(name, phone);
                  go("cart");
                }),
              true,
              !name.trim() && !phone.trim(),
            )}
          </>
        );
      case "item":
        return (
          <>
            {back("more")}
            {heading(t("newItem"))}
            {shop.mode !== "training" ? (
              message(t("serverRequired"))
            ) : (
              <>
                {field(t("name"), name, setName)}
                {field(t("price"), itemPrice, setItemPrice, { numeric: true })}
                {field(
                  t("quickCode") + " · " + t("optional"),
                  itemCode,
                  setItemCode,
                  { numeric: true },
                )}
                {field(t("visual"), itemVisual, setItemVisual)}
                {button(
                  t("save"),
                  () =>
                    void run(async () => {
                      await repo.createItem({
                        id: uuid(),
                        name,
                        price: parseMoney(itemPrice),
                        code: quickCode(itemCode),
                        category: t("items"),
                        visual: itemVisual || "📦",
                        taxBps: shop.quickTaxBps,
                        taxInclusive: shop.quickTaxInclusive,
                        active: true,
                      });
                      setName("");
                      setItemPrice("");
                      setItemCode("");
                      go("sell");
                    }),
                  true,
                  !name.trim() || !itemPrice,
                )}
              </>
            )}
          </>
        );
      case "connection":
        return (
          <>
            {back("more")}
            {heading(t("connection"))}
            {message(
              shop.mode === "training"
                ? t("trainingHelp")
                : (shop.baseUrl ?? ""),
            )}
            {row(t("catalogue"), String(state.items.length))}
            {row(
              t("pending"),
              String(state.outbox.filter((e) => e.state === "pending").length),
            )}
            {row(
              t("review"),
              String(state.outbox.filter((e) => e.state === "review").length),
            )}
            {help(t("offlineReady"))}
            {help(t("wifiFirst"))}
            {connectionError && message(t(connectionError))}
            {button(
              t(syncing ? "reconnecting" : "syncNow"),
              () => void syncNow(true),
              true,
              shop.mode === "training" || syncing,
            )}
            {help(t("keepSelling"))}
            {state.outbox
              .filter((e) => e.error)
              .map((e) => (
                <View style={styles.message} key={e.id}>
                  <Text style={styles.body}>
                    {t(e.error ?? "networkError")}
                  </Text>
                </View>
              ))}
          </>
        );
      case "printer":
        return (
          <>
            {back("more")}
            {heading(t("printer"))}
            {(["system", "till"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                aria-checked={state.settings.printer === value}
                accessibilityState={{
                  checked: state.settings.printer === value,
                  disabled: value === "till" && !shop.capabilities.tillPrint,
                }}
                disabled={value === "till" && !shop.capabilities.tillPrint}
                style={[
                  styles.menu,
                  value === "till" &&
                    !shop.capabilities.tillPrint &&
                    styles.disabled,
                ]}
                onPress={() =>
                  void run(() =>
                    repo.settings({ ...state.settings, printer: value }),
                  )
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>
                    {t(value === "system" ? "systemPrinter" : "tillPrinter")}
                  </Text>
                  {value === "till" && !shop.capabilities.tillPrint && (
                    <Text style={styles.small}>{t("unavailable")}</Text>
                  )}
                </View>
                {state.settings.printer === value ? icon("check") : null}
              </Pressable>
            ))}
            {help(t("printSystemHelp"))}
            <View style={styles.row}>
              <Text style={[styles.body, { flex: 1 }]}>{t("autoPrint")}</Text>
              <Switch
                value={state.settings.autoPrint}
                onValueChange={(value) =>
                  void run(() =>
                    repo.settings({ ...state.settings, autoPrint: value }),
                  )
                }
              />
            </View>
            {button(
              t("testPrint"),
              () =>
                void run(async () => {
                  await printTest(shop, state.settings, t);
                }),
            )}
          </>
        );
      case "pin":
        return (
          <>
            {back("more")}
            {heading(t("setPin"))}
            {help(t("pinHelp"))}
            {field(
              t("pin"),
              pin,
              (value) =>
                setPin(normalizeDigits(value).replace(/\D/g, "").slice(0, 6)),
              { numeric: true, secret: true },
            )}
            {field(
              t("confirmPin"),
              pinConfirm,
              (value) =>
                setPinConfirm(
                  normalizeDigits(value).replace(/\D/g, "").slice(0, 6),
                ),
              { numeric: true, secret: true },
            )}
            {button(
              t("save"),
              () =>
                void run(async () => {
                  if (pin !== pinConfirm) throw new Error("pinMismatch");
                  await vault.enroll(pin);
                  setPinEnabled(true);
                  setPin("");
                  setPinConfirm("");
                  go("sell");
                }),
              true,
              pin.length < 4 || pinConfirm.length < 4,
            )}
          </>
        );
      case "devices":
        return (
          <>
            {back("more")}
            {heading(t("paymentDevices"))}
            {message(t("deviceUnavailable"))}
            {help(t("supportedOnly"))}
          </>
        );
      case "leaveTraining":
        return (
          <>
            {back("more")}
            {heading(t("leaveTraining"))}
            {help(t("clearPracticeHelp"))}
            {button(
              t("clearPractice"),
              () =>
                void run(async () => {
                  await repo.leaveTraining();
                  await vault.clear();
                  setPinEnabled(false);
                  setLastSale(null);
                  setQuery("");
                  setCategory("");
                  setAmount("");
                  setNote("");
                  go("sell");
                }),
              true,
            )}
            {button(t("cancel"), () => go("more"))}
          </>
        );
      default:
        return (
          <>
            {heading(t("more"))}
            {menu("lock", t("setPin"), "pin")}
            {pinEnabled && button(t("lockNow"), lock)}
            {button(t("switchUser"), () => setConfirmSignOut(true))}
            {shop.permissions.itemWrite &&
              menu("package", t("newItem"), "item")}
            {menu(
              "globe",
              t("language"),
              "language",
              languages.find((l) => l.code === locale)?.name,
            )}
            {menu("printer", t("printer"), "printer")}
            {menu("credit-card", t("paymentDevices"), "devices")}
            {menu("refresh-cw", t("connection"), "connection")}
            {help(shop.mode === "training" ? t("trainingHelp") : shop.name)}
            {shop.mode === "training" &&
              menu("log-out", t("leaveTraining"), "leaveTraining")}
          </>
        );
    }
  }
  const navs: { target: Screen; label: string; glyph: IconName }[] = [
    { target: "sell", label: "sell", glyph: "shopping-bag" },
    { target: "held", label: "held", glyph: "pause-circle" },
    { target: "receipts", label: "receipts", glyph: "file-text" },
    { target: "more", label: "more", glyph: "menu" },
  ];
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.shell, rtl && { direction: "rtl" }]}>
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Brand dark={dark} />
              <Text style={styles.small} numberOfLines={1}>
                {shop ? shop.name + " · " + shop.branchName : t("connect")}
              </Text>
            </View>
            {!shop && iconButton("globe", t("language"), () => go("language"))}
            {shop && !locked && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("connection")}
                onPress={() => go("connection")}
                style={styles.status}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        connectionError || state?.outbox.length
                          ? palette.muted
                          : palette.accent,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    !!state?.outbox.length && { color: palette.muted },
                  ]}
                >
                  {t(
                    shop.mode === "training"
                      ? "training"
                      : connectionError
                        ? "offlineWorking"
                        : state?.outbox.length
                          ? "pending"
                          : "ready",
                  )}
                </Text>
              </Pressable>
            )}
          </View>
          {shop?.mode === "live" &&
            (connectionError || !!state?.outbox.length) && (
              <View style={styles.message} accessibilityLiveRegion="polite">
                <Text style={styles.small}>
                  {state?.outbox.filter((e) => e.state === "pending").length}{" "}
                  {t("waitingToSend")} · {t("keepSelling")}
                </Text>
              </View>
            )}
          {error && state && !locked && (
            <View accessibilityRole="alert" style={styles.error}>
              <Text style={[styles.body, { color: palette.danger, flex: 1 }]}>
                {t(error)}
              </Text>
              {iconButton("x", t("dismiss"), () => setError(""))}
            </View>
          )}
          {notice && (
            <View accessibilityLiveRegion="polite" style={styles.message}>
              <Text style={styles.body}>{t(notice)}</Text>
            </View>
          )}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {content()}
          </ScrollView>
          {shop &&
            state &&
            !locked &&
            (screen === "sell" || screen === "quick") && (
              <View style={styles.checkoutDock}>
                <Pressable
                  testID="view-cart"
                  accessibilityRole="button"
                  accessibilityLabel={
                    state.cart.lines.length
                      ? `${t("cart")} · ${money(sum.total)}`
                      : t("emptyCart")
                  }
                  disabled={busy || !state.cart.lines.length}
                  onPress={() => go("cart")}
                  style={({ pressed }) => [
                    styles.checkoutButton,
                    !state.cart.lines.length && styles.checkoutEmpty,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather
                    name="shopping-bag"
                    size={21}
                    color={
                      state.cart.lines.length ? palette.onAccent : palette.muted
                    }
                  />
                  <Text
                    style={[
                      styles.checkoutLabel,
                      !state.cart.lines.length && { color: palette.muted },
                    ]}
                  >
                    {state.cart.lines.length ? t("cart") : t("emptyCart")}
                  </Text>
                  {!!state.cart.lines.length && (
                    <>
                      <Text style={styles.checkoutTotal}>
                        {money(sum.total)}
                      </Text>
                      <Feather
                        name="arrow-right"
                        size={20}
                        color={palette.onAccent}
                      />
                    </>
                  )}
                </Pressable>
              </View>
            )}
          {busy && (
            <View style={styles.busy}>
              <ActivityIndicator color={palette.accent} />
            </View>
          )}
          {shop && !locked && (
            <View style={styles.nav}>
              {navs.map((nav) => {
                const selected =
                  screen === nav.target ||
                  (nav.target === "sell" &&
                    [
                      "cart",
                      "cash",
                      "upi",
                      "quick",
                      "code",
                      "done",
                      "scanner",
                      "customer",
                    ].includes(screen));
                return (
                  <Pressable
                    key={nav.target}
                    accessibilityRole="tab"
                    aria-selected={selected}
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(nav.label)}
                    onPress={() => go(nav.target)}
                    style={[styles.navItem, selected && styles.chipActive]}
                  >
                    <Feather
                      name={nav.glyph}
                      size={20}
                      color={selected ? palette.accent : palette.muted}
                    />
                    <Text
                      style={[
                        styles.navLabel,
                        selected && { color: palette.accent },
                      ]}
                    >
                      {t(nav.label)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function safeAmount(value: string) {
  try {
    return parseMoney(value);
  } catch {
    return 0;
  }
}
function makeStyles(p: {
  paper: string;
  ink: string;
  muted: string;
  line: string;
  wash: string;
  accent: string;
  onAccent: string;
  soft: string;
  danger: string;
}) {
  return StyleSheet.create({
    intro: { paddingTop: 12, paddingBottom: 4 },
    introIcon: {
      width: 52,
      height: 52,
      borderRadius: 17,
      backgroundColor: p.soft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    setupCard: {
      padding: 18,
      gap: 12,
      backgroundColor: p.paper,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: p.line,
    },
    connectionTools: { flexDirection: "row", gap: 10 },
    inputFocused: { borderColor: p.accent, backgroundColor: p.paper },
    checkoutDock: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
      backgroundColor: p.wash,
    },
    checkoutButton: {
      minHeight: 58,
      borderRadius: 17,
      paddingHorizontal: 18,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: p.accent,
    },
    checkoutEmpty: { backgroundColor: p.line },
    checkoutLabel: {
      flex: 1,
      color: p.onAccent,
      fontSize: 14,
      fontWeight: "600",
    },
    checkoutTotal: {
      color: p.onAccent,
      fontSize: 20,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    connectOptions: { flexDirection: "row", gap: 6 },
    connectOption: {
      flex: 1,
      minHeight: 70,
      padding: 8,
      borderRadius: 12,
      backgroundColor: p.wash,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    safe: { flex: 1, backgroundColor: p.wash },
    shell: {
      flex: 1,
      width: "100%",
      maxWidth: 900,
      alignSelf: "center",
      backgroundColor: p.wash,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: p.paper,
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    brand: { fontSize: 24, fontWeight: "700", color: p.ink, letterSpacing: -1 },
    small: { fontSize: 12, color: p.muted, lineHeight: 18 },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      padding: 9,
      borderRadius: 12,
      backgroundColor: p.soft,
      maxWidth: 125,
    },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: {
      fontSize: 11,
      fontWeight: "600",
      color: p.accent,
      flexShrink: 1,
    },
    content: { padding: 16, gap: 14, paddingBottom: 24 },
    heading: {
      fontSize: 25,
      fontWeight: "700",
      color: p.ink,
      letterSpacing: -0.6,
      marginVertical: 8,
    },
    help: { fontSize: 14, lineHeight: 21, color: p.muted, marginVertical: 4 },
    body: { fontSize: 16, lineHeight: 23, color: p.ink },
    value: { fontSize: 17, fontWeight: "600", color: p.ink },
    button: {
      minHeight: 50,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: p.line,
      backgroundColor: p.paper,
      justifyContent: "center",
      alignItems: "center",
      marginVertical: 3,
    },
    buttonText: {
      fontSize: 15,
      fontWeight: "600",
      color: p.ink,
      textAlign: "center",
    },
    primary: { backgroundColor: p.accent, borderColor: p.accent },
    onAccent: { color: p.onAccent },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
    iconButton: {
      width: 46,
      height: 46,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: p.paper,
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 14,
    },
    field: { gap: 7, marginVertical: 3 },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: p.muted },
    input: {
      minHeight: 48,
      borderRadius: 12,
      padding: 12,
      backgroundColor: p.wash,
      color: p.ink,
      fontSize: 16,
      borderWidth: 1,
      borderColor: p.line,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    menu: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: p.line,
      borderRadius: 16,
      backgroundColor: p.paper,
      minHeight: 66,
    },
    message: {
      backgroundColor: p.wash,
      padding: 14,
      borderRadius: 12,
      marginVertical: 4,
    },
    error: {
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    segments: {
      flexDirection: "row",
      backgroundColor: p.line,
      padding: 4,
      borderRadius: 16,
      gap: 4,
    },
    segment: {
      flex: 1,
      minHeight: 46,
      justifyContent: "center",
      padding: 8,
      borderRadius: 11,
    },
    segmentActive: { backgroundColor: p.paper },
    searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    categories: {
      flexDirection: "row",
      gap: 8,
      paddingVertical: 4,
      flexWrap: "wrap",
    },
    chip: {
      minHeight: 44,
      paddingHorizontal: 13,
      paddingVertical: 10,
      justifyContent: "center",
      borderRadius: 22,
      backgroundColor: p.paper,
    },
    chipActive: { backgroundColor: p.soft },
    tile: {
      flex: 1,
      backgroundColor: p.paper,
      borderRadius: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: p.line,
    },
    art: {
      width: 44,
      height: 44,
      marginTop: 12,
      marginStart: 10,
      borderRadius: 13,
      backgroundColor: p.wash,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    tileLabel: { padding: 10, gap: 5 },
    itemName: {
      fontSize: 13,
      fontWeight: "500",
      color: p.ink,
      minHeight: 34,
      lineHeight: 17,
    },
    itemPrice: { fontSize: 14, fontWeight: "700", color: p.ink },
    itemCount: {
      position: "absolute",
      top: 10,
      end: 8,
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 5,
      backgroundColor: p.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    itemCountText: { color: p.onAccent, fontWeight: "700", fontSize: 11 },
    amount: {
      fontSize: 44,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      textAlign: "center",
      color: p.ink,
      marginVertical: 18,
      letterSpacing: -1,
    },
    keypad: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    key: {
      width: "31.5%",
      flexGrow: 1,
      minHeight: 62,
      borderRadius: 16,
      backgroundColor: p.paper,
      borderWidth: 1,
      borderColor: p.line,
      justifyContent: "center",
      alignItems: "center",
    },
    keyText: { fontSize: 24, color: p.ink },
    cartLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: p.line,
    },
    quantity: { flexDirection: "row", alignItems: "center", gap: 8 },
    back: { alignSelf: "flex-start" },
    nav: {
      backgroundColor: p.paper,
      flexDirection: "row",
      padding: 8,
      borderTopWidth: 1,
      borderTopColor: p.line,
      gap: 4,
    },
    navItem: {
      flex: 1,
      minWidth: 0,
      minHeight: 58,
      justifyContent: "center",
      alignItems: "center",
      gap: 5,
      borderRadius: 12,
      padding: 4,
    },
    navLabel: {
      width: "100%",
      fontSize: 11,
      color: p.muted,
      textAlign: "center",
    },
    loading: { padding: 30, alignItems: "center", gap: 20 },
    busy: { position: "absolute", top: 16, right: 16 },
    qr: {
      padding: 18,
      backgroundColor: "#fff",
      alignSelf: "center",
      borderRadius: 12,
      marginVertical: 12,
    },
    success: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: p.soft,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginTop: 16,
    },
    camera: { height: 340, borderRadius: 18, overflow: "hidden" },
  });
}
