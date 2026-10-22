import { createClient } from "@supabase/supabase-js";
export const db = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
export async function call(action: string, body: unknown = {}) {
  const {
    data: { session },
  } = await db.auth.getSession();
  const r = await fetch(
    import.meta.env.VITE_SUPABASE_URL + "/functions/v1/wasl/" + action,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + session?.access_token,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const result = await r.json();
  if (!r.ok || result.ok === false)
    throw Error(result.error || "تعذر تنفيذ العملية");
  return result;
}
export function checked<T>(r: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (r.error) throw Error(r.error.message);
  return r.data as NonNullable<T>;
}
export type Order = {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  phone: string;
  address: string;
  product: string;
  amount: number;
  status: import("../shared/domain").Status;
  tracking: string | null;
  carrier_status: string;
  notes: string;
  created_at: string | null;
  confirmed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  origin: string;
  updated_at: string;
  details?: {
    finance?: string;
    stages?: string;
    text?: string;
    sheet?: Record<string, unknown>;
    manualCustomer?: boolean;
  };
};
export const date = (s?: string | null) =>
  s ? new Date(s).toLocaleString("ar-EG") : "—";
