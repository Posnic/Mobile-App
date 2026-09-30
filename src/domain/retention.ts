import type { DirectPrintJob, Outbox, Sale } from "./types";

export function receiptsToPrune(
  sales: Sale[],
  outbox: Outbox[],
  jobs: DirectPrintJob[],
  policy = { days: 90, maxReceipts: 10000 },
  now = Date.now(),
): string[] {
  if (
    !Number.isInteger(policy.days) ||
    policy.days < 1 ||
    !Number.isInteger(policy.maxReceipts) ||
    policy.maxReceipts < 1
  )
    return [];
  const protectedIds = new Set([
    ...outbox.map((row) => row.saleId),
    ...jobs.filter((job) => job.state !== "confirmed").map((job) => job.saleId),
  ]);
  const eligible = sales
    .filter(
      (sale) =>
        !sale.training &&
        sale.sync === "synced" &&
        !sale.tillPrint &&
        !protectedIds.has(sale.id) &&
        Number.isFinite(Date.parse(sale.createdAt)),
    )
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
  return eligible
    .filter(
      (sale, index) =>
        index >= policy.maxReceipts ||
        Date.parse(sale.createdAt) < now - policy.days * 86400000,
    )
    .map((sale) => sale.id);
}
