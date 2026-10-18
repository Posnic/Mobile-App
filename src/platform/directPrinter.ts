import { requireOptionalNativeModule } from "expo";
import { PermissionsAndroid, Platform } from "react-native";
import type { Sale, Settings } from "../domain/types";
import type { Repository } from "../data/repository";
import { receiptText } from "../services/receiptText";
import { designedReceipt } from "../services/designedReceipt";
import * as Print from "expo-print";
import { File } from "expo-file-system";

const native = requireOptionalNativeModule<{
  usbDevices(): Promise<{ address: string; name: string }[]>;
  requestUsbPermission(address: string): Promise<string | null>;
  pairedDevices(): Promise<{ address: string; name: string }[]>;
  printPdf(
    address: string,
    uri: string,
    width: number,
    drawerPin: number,
  ): Promise<{ state: "submitted" | "unknown" | "failed" }>;
  printReceipt(
    address: string,
    text: string,
    width: number,
    drawerPin: number,
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
export async function usbPrinters() {
  if (!directPrinterAvailable) throw new Error("nativeBuildRequired");
  try {
    return await native!.usbDevices();
  } catch {
    throw new Error("deviceUnavailable");
  }
}
export async function authorizeDirectPrinter(printer: {
  address: string;
  name: string;
}) {
  if (!printer.address.startsWith("usb:")) return printer;
  if (!directPrinterAvailable) throw new Error("nativeBuildRequired");
  const address = await native!
    .requestUsbPermission(printer.address)
    .catch(() => null);
  if (!address) throw new Error("permissionDenied");
  return { ...printer, address };
}
async function printerPermission(address: string) {
  if (address.startsWith("usb:")) {
    if (!directPrinterAvailable) throw new Error("nativeBuildRequired");
    try {
      if ((await native!.requestUsbPermission(address)) !== address)
        throw new Error("permissionDenied");
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message === "permissionDenied"
          ? "permissionDenied"
          : "deviceUnavailable",
      );
    }
  } else await pairedPrinters();
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
  const state = await repo.load();
  if (
    !state.shop?.permissions.receiptPrint ||
    Date.parse(state.shop.offlineUntil) <= Date.now()
  )
    throw new Error("permissionDenied");
  const previous = (await repo.directPrintJobs()).find(
    (job) => job.saleId === sale.id,
  );
  const printer =
    !reprint && previous ? previous.printer : state.settings.directPrinter;
  if (!printer) throw new Error("deviceUnavailable");
  await printerPermission(printer.address);
  const html = designedReceipt(
    sale,
    state.shop,
    t,
    locale,
    printer.width === 384 ? "58" : "80",
  );
  // Render before claiming the printer job. A PDF failure sends no paper and
  // must not leave the job in the uncertain transport state.
  const pdf = html
    ? await Print.printToFileAsync({
        html,
        width: Math.round(((printer.width === 384 ? 58 : 80) * 72) / 25.4),
        height: 1000,
      })
    : null;
  let result: "submitted" | "unknown" | "failed" = "unknown";
  let claimed = false;
  try {
    const job = await repo.prepareDirectPrint(sale.id, reprint);
    claimed = true;
    result = pdf
      ? (
          await native!.printPdf(
            job.printer.address,
            pdf.uri,
            job.printer.width,
            job.drawerPulse ?? -1,
          )
        ).state
      : (
          await native!.printReceipt(
            job.printer.address,
            receiptText(sale, name, locale, t),
            job.printer.width,
            job.drawerPulse ?? -1,
          )
        ).state;
  } finally {
    if (claimed) await repo.completeDirectPrint(sale.id, result);
    if (pdf) {
      try {
        new File(pdf.uri).delete();
      } catch {}
    }
  }
  if (result === "failed") throw new Error("deviceUnavailable");
  return result;
}
export async function testDirect(settings: Settings, title: string) {
  if (!settings.directPrinter) throw new Error("deviceUnavailable");
  await printerPermission(settings.directPrinter.address);
  const result = await native!.printReceipt(
    settings.directPrinter.address,
    title + "\n0123456789\n✓ ──────────\n",
    settings.directPrinter.width,
    -1,
  );
  if (result.state !== "submitted")
    throw new Error(
      result.state === "unknown" ? "printCheckPaper" : "deviceUnavailable",
    );
}
