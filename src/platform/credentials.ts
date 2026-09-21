export const credentials = {
  deviceId: async () => (await import("./vault")).vault.deviceId(),
  get: async () => (await import("./vault")).vault.token(),
  set: async (token: string) => (await import("./vault")).vault.setToken(token),
};
