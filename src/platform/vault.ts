import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { SessionVault } from "../services/sessionVault";
export const vault = new SessionVault(
  {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
  },
  (length) => Crypto.getRandomBytes(length),
);
