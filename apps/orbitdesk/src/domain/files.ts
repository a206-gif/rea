const windowsReserved = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

export function sanitizeFilename(input: string, fallback = "orbitdesk-download"): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
  if (cleaned.length === 0) return fallback;
  const stem = cleaned.split(".")[0]?.toUpperCase() ?? "";
  return windowsReserved.has(stem) ? `_${cleaned}` : cleaned;
}

export function safeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random.replaceAll("-", "")}`;
}
