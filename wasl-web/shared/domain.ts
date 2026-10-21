export const statuses = {
  new: "طلب جديد",
  confirmed: "تم التأكيد",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  returned: "مرتجع",
  cancelled: "ملغي",
};
export type Status = keyof typeof statuses;
export function digits(s: string) {
  return s
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
}
export function plain(s: string) {
  return digits(s)
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
export function phone(s: string) {
  let n = digits(s)
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "")
    .replace(/^00/, "");
  if (/^01[0125]\d{8}$/.test(n)) n = "2" + n;
  if (/^1[0125]\d{8}$/.test(n)) n = "20" + n;
  return /^201[0125]\d{8}$/.test(n) ? "+" + n : null;
}
export function phones(s: string) {
  return [
    ...new Set(
      (
        digits(s).match(
          /(?<!\d)(?:\+?20|0020|0)?1[0125](?:[ \t().-]*\d){8}(?!\d)/g,
        ) || []
      )
        .map(phone)
        .filter((x): x is string => !!x),
    ),
  ];
}
export function tracking(s: string) {
  const t = digits(s).toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z]{2}[0-9OIL]{9}EG$/.test(t)) return null;
  return (
    t.slice(0, 2) +
    t.slice(2, 11).replace(/O/g, "0").replace(/[IL]/g, "1") +
    "EG"
  );
}
export function trackings(s: string) {
  return [
    ...new Set(
      (digits(s).match(/[A-Z]{2}[ \t]?(?:[0-9OIL][ \t]?){9}EG/gi) || [])
        .map(tracking)
        .filter((x): x is string => !!x),
    ),
  ];
}
export function sheetStatus(s: string): Status | null {
  const n = plain(s);
  const map: Record<string, Status> = {
    جديد: "new",
    "طلب جديد": "new",
    new: "new",
    "تم التاكيد": "confirmed",
    مؤكد: "confirmed",
    موكد: "confirmed",
    confirmed: "confirmed",
    paid: "confirmed",
    "تم الدفع": "confirmed",
    "تم الشحن": "shipped",
    مشحون: "shipped",
    shipped: "shipped",
    "تم التوصيل": "delivered",
    "تم التسليم": "delivered",
    delivered: "delivered",
    مرتجع: "returned",
    returned: "returned",
    ملغي: "cancelled",
    cancelled: "cancelled",
  };
  return map[n] || null;
}
export function advance(current: Status, incoming: Status): Status {
  if (["delivered", "returned", "cancelled"].includes(current)) return current;
  if (incoming === "returned" || incoming === "cancelled") return incoming;
  return ["new", "confirmed", "shipped", "delivered"].indexOf(incoming) >
    ["new", "confirmed", "shipped", "delivered"].indexOf(current)
    ? incoming
    : current;
}
export type Evidence = {
  tracking: string;
  kind: "delivered" | "attempt" | "created" | "unknown";
  text: string;
  receivedAt?: string;
};
export function postal(text: string): Evidence[] {
  const blocks = digits(text)
    .normalize("NFKC")
    .split(/(?=عميلنا\s+العزيز|عزيزي\s+العميل|Dear\s+customer)/i);
  return blocks.flatMap((block) => {
    const n = plain(block);
    const kind: Evidence["kind"] = /لم يتم|تعذر|لم نتمكن|عدم التسليم/.test(n)
      ? "attempt"
      : /تم\s+تسليم\s+(الشحنة|شحنتك)/.test(n)
        ? "delivered"
        : /تم\s+انشاء/.test(n)
          ? "created"
          : "unknown";
    return trackings(block).map((t) => ({
      tracking: t,
      kind,
      text: block.trim().slice(0, 3000),
    }));
  });
}
export function sheetId(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "docs.google.com"
      ? u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1] || null
      : null;
  } catch {
    return null;
  }
}
export function csv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (q && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      row.push(cell);
      cell = "";
    } else if (/[\r\n]/.test(c) && !q) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
