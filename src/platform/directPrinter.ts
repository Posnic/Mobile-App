import { requireOptionalNativeModule } from "expo";
import { PermissionsAndroid, Platform } from "react-native";
import type { Sale, Settings } from "../domain/types";
import type { Repository } from "../data/repository";
import { receiptText } from "../services/receiptText";

const native = requireOptionalNativeModule<{
  pairedDevices(): Promise<{ address: string; name: string }[]>;
  printReceipt(
    address: string,
    text: string,
    width: number,
  ): Promise<{ state: "submitted" | "unknown" | "failed" }>;
}>("PosnicPrinter");
export const directPrinterAvailable = Platform.OS === "android" && !!native;
export async function pairedPrinters() {
  if (!directPrinterAvailable) throw new Error("nativeBuildRequired");
  if (Number(Platform.Version) >= 31) {
    const permission = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    );
    if (permission !== PermissionsAndroid.RESULTS.GRANTED)
      throw new Error("permissionDenied");
  }
  try {
    return await native!.pairedDevices();
  } catch {
    throw new Error("deviceUnavailable");
  }
}
export async function printDirect(
  repo: Repository,
  sale: Sale,
  name: string,
  locale: string,
  t: (key: string) => string,
  reprint = false,
) {
  if (!directPrinterAvailable) throw new Error("nativeBuildRequired");
  // Fail before claiming a job if Android access was denied.
  await pairedPrinters();
  const job = await repo.prepareDirectPrint(sale.id, reprint);
  let result: "submitted" | "unknown" | "failed" = "unknown";
  try {
    result = (
      await native!.printReceipt(
        job.printer.address,
        receiptText(sale, name, locale, t),
        job.printer.width,
      )
    ).state;
  } finally {
    await repo.completeDirectPrint(sale.id, result);
  }
  if (result === "failed") throw new Error("deviceUnavailable");
  return result;
}
export async function testDirect(settings: Settings, title: string) {
  await pairedPrinters();
  if (!settings.directPrinter) throw new Error("deviceUnavailable");
  const result = await native!.printReceipt(
    settings.directPrinter.address,
    title + "\n0123456789\n✓ ──────────\n",
    settings.directPrinter.width,
  );
  if (result.state !== "submitted")
    throw new Error(
      result.state === "unknown" ? "printCheckPaper" : "deviceUnavailable",
    );
}
