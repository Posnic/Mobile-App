import { z } from "zod";
import { privateIpv4 } from "./serverAddress";
export interface LocalAuthorization {
  deviceId: string;
  name: string;
  addresses: string[];
  code?: string;
  enrolmentId?: string;
}
export interface CloudAuthorization {
  baseUrl: string;
  verifier: string;
  connectionToken?: string;
  localServers: LocalAuthorization[];
  updatedAt: number;
}
export function localAuthorizations(value: unknown): LocalAuthorization[] {
  if (!Array.isArray(value)) return [];
  const result: LocalAuthorization[] = [];
  for (const row of value.slice(0, 8)) {
    if (
      !row ||
      typeof row.deviceId !== "string" ||
      !/^[\w-]{1,128}$/.test(row.deviceId)
    )
      continue;
    const addresses = Array.isArray(row.addresses)
      ? row.addresses
          .filter((raw: unknown) => {
            if (typeof raw !== "string") return false;
            try {
              const u = new URL(raw);
              return (
                ["http:", "https:"].includes(u.protocol) &&
                privateIpv4(u.hostname) &&
                u.pathname === "/api" &&
                !u.username &&
                !u.password &&
                !u.search &&
                !u.hash &&
                u.href === raw
              );
            } catch {
              return false;
            }
          })
          .slice(0, 8)
      : [];
    if (!addresses.length) continue;
    result.push({
      deviceId: row.deviceId,
      name: typeof row.name === "string" ? row.name.slice(0, 100) : "",
      addresses,
      ...(typeof row.code === "string" &&
      /^[A-F0-9]{12}$/.test(row.code) &&
      typeof row.enrolmentId === "string" &&
      /^[\w-]{36}$/.test(row.enrolmentId)
        ? { code: row.code, enrolmentId: row.enrolmentId }
        : {}),
    });
  }
  return result;
}

/** Cloud sign-in stays on the approved internet server, even on shop Wi-Fi. */
export function cloudGrant(value: unknown) {
  const grant = z
    .object({
      baseUrl: z.string().url(),
      code: z.string().regex(/^[A-F0-9]{12}$/),
    })
    .parse(value);
  const endpoint = new URL(grant.baseUrl);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("invalidServer");
  // Nearby tills may have independent sale journals. Choosing one silently
  // strands cloud users on Wi-Fi and cannot safely migrate their pending sales.
  const extra = value as Record<string, unknown>;
  const localServers = localAuthorizations(extra.localServers);
  return {
    ...grant,
    ...(typeof extra.connectionToken === "string" &&
    /^[\w-]{43}$/.test(extra.connectionToken)
      ? { connectionToken: extra.connectionToken }
      : {}),
    ...(localServers.length ? { localServers } : {}),
  };
}
export function cloudAuthorization(
  grant: ReturnType<typeof cloudGrant> & { verifier: string },
): CloudAuthorization {
  return {
    baseUrl: grant.baseUrl,
    verifier: grant.verifier,
    connectionToken: grant.connectionToken,
    localServers: grant.localServers ?? [],
    updatedAt: Date.now(),
  };
}
