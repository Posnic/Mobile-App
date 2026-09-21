// Browser is an evaluation surface. Never persist bearer credentials in web storage.
import { vault } from "./vault";
export const credentials = {
  deviceId: async () => vault.deviceId(),
  get: async () => vault.token(),
  set: async (value: string) => {
    await vault.setToken(value);
  },
};
