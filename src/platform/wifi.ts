import * as Network from "expo-network";
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { privateIpv4 } from "../services/serverAddress";
export async function wifiAddress(): Promise<string> {
  const addresses: string[] = [];
  try {
    const network = await Network.getNetworkStateAsync();
    if (network.type === Network.NetworkStateType.WIFI && network.isConnected)
      addresses.push(await Network.getIpAddressAsync());
  } catch {
    /* Hotspot hosts may have only a mobile-data default route. */
  }
  try {
    const native = requireOptionalNativeModule<{
      networkAddresses: () => Promise<string[]>;
    }>(Platform.OS === "ios" ? "PosnicSecurity" : "PosnicPrinter");
    if (native?.networkAddresses)
      addresses.push(...(await native.networkAddresses()));
  } catch {
    /* Manual address/QR remains available on restricted OS versions. */
  }
  const address = addresses.find(privateIpv4);
  if (!address) throw Error("wifiRequired");
  return address;
}
