import * as Crypto from "expo-crypto";
import {
  cloudAuthorization,
  type CloudAuthorization,
} from "../services/cloudGrant";
import {
  refreshLocalAuthorizations,
  verifyEnrolment,
} from "../services/localAuthorization";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { Shop } from "../domain/types";
import type { Repository } from "../data/repository";
import { PosnicApi, ApiError } from "../services/api";
import { discoverServers, type DiscoveredServer } from "../services/discovery";
import { isLocalServer, parseServerInput } from "../services/serverAddress";
import { wifiAddress } from "../platform/wifi";
import { vault } from "../platform/vault";
import { authorizeAccount, base64url } from "../services/accountAuthorization";
import { openAccountBrowser } from "../platform/authBrowser";
type Data = Awaited<ReturnType<PosnicApi["connect"]>>;
type Props = {
  shop: Shop;
  repo: Repository;
  t: (key: string) => string;
  back: () => void;
  apply: (
    data: Data,
    username: string,
    signal: AbortSignal,
    authorization?: CloudAuthorization,
  ) => Promise<void>;
  internet?: boolean;
  wifi?: boolean;
  colors: {
    ink: string;
    muted: string;
    accent: string;
    paper: string;
    line: string;
    soft: string;
  };
};
export function Connections({
  shop,
  repo,
  t,
  back,
  apply,
  colors: c,
  internet,
  wifi,
}: Props) {
  const [saved, setSaved] = useState<string[]>([]),
    [view, setView] = useState("home"),
    [address, setAddress] = useState(""),
    [selected, setSelected] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [useCode, setUseCode] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [found, setFound] = useState<DiscoveredServer[]>([]),
    [progress, setProgress] = useState(""),
    [match, setMatch] = useState("");
  const [setup, setSetup] = useState(false);
  const [authorization, setAuthorization] = useState<CloudAuthorization>();
  const autoStarted = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const operation = useRef<AbortController | null>(null),
    alive = useRef(true),
    scanLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    void repo
      .connections(shop)
      .then((value) => {
        if (alive.current) setSaved(value);
      })
      .catch(() => setError("storageUnavailable"));
    const ctrl = new AbortController();
    void (async () => {
      const account = await vault.account();
      if (!alive.current) return;
      if (account?.cloudAuthorization) {
        setAuthorization(account.cloudAuthorization);
        try {
          const updated =
            internet || wifi
              ? account.cloudAuthorization
              : await refreshLocalAuthorizations(
                  account.cloudAuthorization,
                  ctrl.signal,
                );
          if (!alive.current || ctrl.signal.aborted) return;
          await vault.updateCloudAuthorization(updated);
          setAuthorization(updated);
        } catch {
          /* Internet may be unavailable; saved local sessions still work. */
        }
      }
      if (ctrl.signal.aborted || !alive.current) return;
      if (wifi && !autoStarted.current && alive.current) {
        autoStarted.current = true;
        const known = await repo.connections(shop);
        const local = known.filter(isLocalServer);
        if (local.length === 1) void run((signal) => choose(local[0]!, signal));
        else {
          setView("wifi");
          if (
            !local.length &&
            !account?.cloudAuthorization?.localServers.length
          )
            void run(search);
        }
      }
      if (internet && !autoStarted.current && alive.current) {
        autoStarted.current = true;
        const endpoint =
          account?.cloudAuthorization?.baseUrl ||
          (await repo.connections(shop)).find((url) => !isLocalServer(url));
        void run((signal) =>
          endpoint ? choose(endpoint, signal) : cloud(signal),
        );
      }
    })().catch(() => {
      if (alive.current) setError("storageUnavailable");
    });
    return () => {
      ctrl.abort();
      alive.current = false;
      operation.current?.abort();
      operation.current = null;
      autoStarted.current = false;
    };
  }, [repo, shop.baseUrl, internet, wifi]);
  const text = { color: c.ink, fontSize: 17 };
  const button = (
    label: string,
    action: () => void,
    icon?: React.ComponentProps<typeof Feather>["name"],
    availableWhileSearching = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy && !availableWhileSearching}
      onPress={action}
      style={{
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 16,
        padding: 16,
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        opacity: busy && !availableWhileSearching ? 0.5 : 1,
        backgroundColor: c.paper,
      }}
    >
      {icon && <Feather name={icon} size={22} color={c.accent} />}
      <Text style={{ ...text, flex: 1 }}>{label}</Text>
      <Feather name="chevron-right" size={18} color={c.muted} />
    </Pressable>
  );
  const input = (
    label: string,
    value: string,
    set: (s: string) => void,
    secret = false,
  ) => (
    <View>
      <Text style={{ ...text, marginBottom: 8 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={set}
        editable={!busy}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          ...text,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 14,
          padding: 15,
          backgroundColor: c.paper,
        }}
      />
    </View>
  );
  async function run(fn: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const ctrl = new AbortController();
    operation.current = ctrl;
    setBusy(true);
    setError("");
    try {
      await Promise.race([
        fn(ctrl.signal),
        new Promise<void>((resolve) => {
          ctrl.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        }),
      ]);
    } catch (e) {
      if (alive.current && !ctrl.signal.aborted)
        setError(e instanceof Error ? e.message : "unknownError");
    } finally {
      if (operation.current === ctrl) {
        if (alive.current) {
          setBusy(false);
          setMatch("");
        }
        operation.current = null;
      }
    }
  }
  async function accept(
    data: Data,
    signal: AbortSignal,
    loginName = data.shop.staffName,
    authorization?: CloudAuthorization,
  ) {
    if (signal.aborted || !alive.current) return;
    if (
      data.shop.id !== shop.id ||
      data.shop.branchId !== shop.branchId ||
      data.shop.staffId !== shop.staffId
    )
      throw Error("connectionWrongShop");
    await apply(data, loginName, signal, authorization);
  }
  async function choose(raw: string, signal: AbortSignal) {
    const parsed = parseServerInput(raw);
    const api = new PosnicApi(parsed.address);
    const runtime = await api.probe();
    if (runtime.features?.mobilePosV1 !== true) throw Error("serverUpgrade");
    if (signal.aborted) return;
    setSelected(parsed.address);
    setAddress(parsed.address);
    setPassword("");
    setCode(parsed.code ?? "");
    if (parsed.code) setUseCode(true);
    const account = await vault.accountFor(parsed.address);
    if (account) {
      try {
        const data = await api.catalogue();
        await accept(
          { ...data, token: account.token },
          signal,
          account.username,
        );
        return;
      } catch (e) {
        if (
          !["signInFailed", "permissionDenied"].includes(
            e instanceof Error ? e.message : "",
          )
        )
          throw e;
      }
    }
    if (signal.aborted || !alive.current) return;
    const context = (await vault.account())?.cloudAuthorization;
    const target = context?.localServers.find((row) =>
      row.addresses.includes(parsed.address),
    );
    if (context && target) {
      if (!target.code || !target.enrolmentId)
        throw Error("authorizationExpired");
      const nonce = base64url(await Crypto.getRandomBytesAsync(32));
      const proofApi = new PosnicApi(parsed.address, fetch, 2500);
      for (let attempt = 0; attempt < 12; attempt++) {
        if (signal.aborted || !alive.current) return;
        let answer: unknown;
        try {
          answer = await proofApi.request("/mobile/v1/enrolment-proof", {
            enrolmentId: target.enrolmentId,
            nonce,
          });
        } catch (e) {
          if (!(e instanceof ApiError) || ![0, 404, 503].includes(e.status))
            throw e;
          if (attempt === 11) throw Error("localApprovalWaiting");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        verifyEnrolment(target, nonce, answer);
        if (signal.aborted || !alive.current) return;
        await accept(
          await api.connect("", "", target.code, false, context.verifier),
          signal,
        );
        return;
      }
    }
    if (context?.baseUrl === parsed.address) {
      await cloud(signal);
      return;
    }
    setUsername(account?.username ?? "");
    setView("login");
  }
  async function cloud(signal: AbortSignal) {
    const grant = await authorizeAccount(
      "login",
      async (url, code) => {
        setMatch(code);
        await openAccountBrowser(url, signal);
      },
      signal,
    );
    if (signal.aborted) return;
    await accept(
      await new PosnicApi(grant.baseUrl).connect(
        "",
        "",
        grant.code,
        false,
        grant.verifier,
      ),
      signal,
      undefined,
      cloudAuthorization(grant),
    );
  }
  async function search(signal: AbortSignal) {
    setView("wifi");
    setFound([]);
    await discoverServers(
      await wifiAddress(),
      signal,
      (server) => {
        if (alive.current && !signal.aborted)
          setFound((old) =>
            old.some((s) => s.address === server.address)
              ? old
              : [...old, server],
          );
      },
      (done, total) => {
        if (alive.current && !signal.aborted) setProgress(`${done}/${total}`);
      },
    );
  }
  return (
    <View testID="connection-panel" style={{ gap: 16 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("back")}
        onPress={() => {
          operation.current?.abort();
          back();
        }}
        style={{
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Feather name="arrow-left" size={24} color={c.accent} />
        <Text style={text}>{t("back")}</Text>
      </Pressable>
      <Text
        accessibilityRole="header"
        style={{ ...text, fontSize: 28, fontWeight: "700" }}
      >
        {t("connection")}
      </Text>
      {error !== "" && (
        <Text accessibilityRole="alert" style={{ ...text, color: c.accent }}>
          {t(error)}
        </Text>
      )}
      {error === "authorizationExpired" &&
        button(
          t("cloudAccount") + " · " + t("signIn"),
          () => void run(cloud),
          "globe",
        )}
      {busy && (
        <View style={{ gap: 10 }}>
          <ActivityIndicator color={c.accent} />
          <Text style={text}>
            {match ? t("authorizeInBrowser") + " " + match : t("loading")}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => operation.current?.abort()}
            style={{ padding: 16 }}
          >
            <Text style={text}>{t("cancel")}</Text>
          </Pressable>
        </View>
      )}
      {view === "home" && (
        <>
          <Text style={{ ...text, color: c.muted }}>
            {shop.name}
            {shop.branchName !== shop.name ? " · " + shop.branchName : ""}
          </Text>
          {button(
            t("connectionWifi"),
            () => {
              setView("wifi");
              if (
                !saved.some(isLocalServer) &&
                !authorization?.localServers.length
              )
                void run(search);
            },
            "wifi",
          )}
          {button(
            t("connectionInternet"),
            () =>
              void run(async (signal) => {
                const endpoint =
                  authorization?.baseUrl ||
                  saved.find((s) => !isLocalServer(s));
                if (endpoint) await choose(endpoint, signal);
                else await cloud(signal);
              }),
            "globe",
          )}
        </>
      )}
      {(view === "home" || view === "wifi") && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("connectionOther")}
            onPress={() => setSetup(!setup)}
            style={{ paddingVertical: 12, flexDirection: "row", gap: 8 }}
          >
            <Text style={{ ...text, color: c.muted }}>
              {t("connectionOther")}
            </Text>
            <Feather
              name={setup ? "chevron-up" : "chevron-down"}
              size={20}
              color={c.muted}
            />
          </Pressable>
          {setup && (
            <>
              {button(
                t("shopQr"),
                () => {
                  scanLock.current = false;
                  setView("scan");
                },
                "maximize",
              )}
              {button(
                t("pairCode"),
                () => {
                  setUseCode(true);
                  setView("address");
                },
                "key",
              )}
              {button(
                t("server"),
                () => {
                  setUseCode(false);
                  setView("address");
                },
                "edit-3",
              )}
            </>
          )}
        </>
      )}
      {view === "wifi" && (
        <>
          <Text style={{ color: c.muted }}>
            {t("chooseServer")} · {progress}
          </Text>
          {Array.from(
            new Map<
              string,
              { address: string; name: string; compatible: boolean }
            >([
              ...(authorization?.localServers ?? []).flatMap((row) =>
                row.addresses.map(
                  (address) =>
                    [
                      address,
                      {
                        address,
                        name:
                          shop.name +
                          (shop.branchName !== shop.name
                            ? " · " + shop.branchName
                            : ""),
                        compatible: true,
                      },
                    ] as const,
                ),
              ),
              ...saved
                .filter(isLocalServer)
                .map(
                  (address) =>
                    [
                      address,
                      { address, name: shop.name, compatible: true },
                    ] as const,
                ),
              ...found.map(
                (hit) =>
                  [
                    hit.address,
                    {
                      ...hit,
                      name:
                        hit.name ||
                        (saved.includes(hit.address)
                          ? shop.name
                          : t("nearbyShop")),
                    },
                  ] as const,
              ),
            ]).values(),
          ).map((hit) => (
            <View key={hit.address}>
              {button(
                hit.name + " · " + t("useServer"),
                () => {
                  operation.current?.abort();
                  setTimeout(
                    () => void run((signal) => choose(hit.address, signal)),
                    0,
                  );
                },
                "shopping-bag",
                true,
              )}
              <Text
                style={{
                  color: c.muted,
                  fontSize: 12,
                  paddingHorizontal: 16,
                  paddingBottom: 6,
                }}
              >
                {new URL(hit.address).host}
                {!hit.compatible ? " · " + t("serverUpgrade") : ""}
              </Text>
            </View>
          ))}
          {!busy && found.length === 0 && (
            <Text style={text}>{t("wifiNotFound")}</Text>
          )}
          {button(t("searchWifi"), () => void run(search), "refresh-cw")}
        </>
      )}
      {view === "address" && (
        <>
          {input(t("server"), address, setAddress)}
          {button(
            t("next"),
            () => void run((s) => choose(address, s)),
            "arrow-right",
          )}
        </>
      )}
      {view === "login" && (
        <>
          <Text selectable style={{ color: c.muted }}>
            {selected}
          </Text>
          {useCode ? (
            input(t("pairCode"), code, setCode)
          ) : (
            <>
              {input(t("username"), username, setUsername)}
              {input(t("password"), password, setPassword, true)}
            </>
          )}
          {button(
            t(useCode ? "pair" : "signIn"),
            () =>
              void run(async (signal) =>
                accept(
                  await new PosnicApi(selected).connect(
                    useCode ? "" : username,
                    useCode ? "" : password,
                    useCode ? code : undefined,
                    false,
                  ),
                  signal,
                  useCode ? undefined : username.trim(),
                ),
              ),
            "check",
          )}
          {button(
            t(useCode ? "signIn" : "pairCode"),
            () => setUseCode(!useCode),
            "key",
          )}
        </>
      )}
      {view === "scan" && (
        <>
          {!permission?.granted ? (
            button(
              t("cameraPermission"),
              () => void requestPermission(),
              "camera",
            )
          ) : (
            <CameraView
              style={{ height: 300, borderRadius: 16 }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (scanLock.current) return;
                scanLock.current = true;
                void run(async (signal) => {
                  try {
                    await choose(data, signal);
                  } finally {
                    scanLock.current = false;
                  }
                });
              }}
            />
          )}
          {button(t("server"), () => setView("address"), "edit-3")}
        </>
      )}
      {view !== "home" &&
        !busy &&
        button(
          t("connection"),
          () => {
            setError("");
            setView("home");
          },
          "globe",
        )}
    </View>
  );
}
