export const credentials = {
  forServer: async (server: string) => {
    const account = await (await import("./vault")).vault.account();
    return account?.server === server ? account.token : null;
  },
  deviceId: async () => (await import("./vault")).vault.deviceId(),
  get: async (server?: string) => {
    const { vault } = await import("./vault");
    return server
      ? ((await vault.accountFor(server))?.token ?? null)
      : vault.token();
  },
  set: async (token: string) => (await import("./vault")).vault.setToken(token),
};
