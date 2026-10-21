import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { phone, tracking, sheetStatus, postal, sheetId } from "./domain.ts";
import { sendPush } from "./push.ts";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-wasl-device",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function check<T>(r: { data: T; error: unknown }) {
  if (r.error) fail("تعذر حفظ البيانات. أعد المحاولة.", 500);
  return r.data;
}
async function digest(s: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function secret(name: string) {
  return check(await db.rpc("runtime_secret", { p_name: name }));
}
async function member(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
  if (!token) fail("سجّل الدخول", 401);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) fail("انتهت جلسة الدخول", 401);
  const p = check(
    await db.from("profiles").select("*").eq("id", data.user.id).single(),
  );
  return p;
}
async function admin(req: Request) {
  const p = await member(req);
  if (p.role !== "admin") fail("هذه العملية للمدير فقط", 403);
  return p;
}
async function device(req: Request) {
  const token =
    req.headers.get("x-wasl-device") ||
    req.headers.get("Authorization")?.replace(/^Bearer /i, "") ||
    "";
  if (!/^[0-9a-f]{64}$/.test(token)) fail("اربط الهاتف أولًا", 401);
  const d = check(
    await db
      .from("devices")
      .select("*")
      .eq("token_hash", await digest(token))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
  );
  if (!d) fail("انتهى اقتران الهاتف", 401);
  check(
    await db
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", d.id),
  );
  return d;
}
async function ingest(w: string, events: any[], source: string) {
  if (!Array.isArray(events) || events.length > 200)
    fail("ارفع الرسائل على دفعات حتى 200 رسالة");
  const records = [];
  const acknowledged = [];
  for (const e of events) {
    const text = String(e.text || "").slice(0, 12000);
    if (!text) continue;
    if (
      source === "android" &&
      !/egypt[ -]?post|البريد المصري/i.test(String(e.sender))
    )
      continue;
    const date =
      e.receivedAt && Number.isFinite(Date.parse(e.receivedAt))
        ? new Date(e.receivedAt).toISOString()
        : null;
    const key = await digest(String(e.eventId || text + "\n" + date));
    for (const m of postal(text))
      records.push({
        workspace_id: w,
        event_key: key,
        tracking: m.tracking,
        kind: m.kind,
        text: m.text,
        received_at: date,
        source,
      });
    if (e.eventId) acknowledged.push(e.eventId);
  }
  if (records.length)
    check(
      await db.from("postal_events").upsert(records, {
        onConflict: "workspace_id,event_key,tracking",
        ignoreDuplicates: true,
      }),
    );
  const st = check(
    await db
      .from("settings")
      .select("automatic_postal")
      .eq("workspace_id", w)
      .single(),
  );
  const applied = st.automatic_postal
    ? check(await db.rpc("apply_postal", { p_workspace: w }))
    : 0;
  return { ok: true, parsed: records.length, applied, acknowledged };
}
async function signedSnapshot(w: string, id: string) {
  const config = check(await db.rpc("get_sheet_secret", { p_workspace: w }));
  if (!config || config.sheet_id !== id)
    fail(
      "الشيت الخاص يحتاج ربط حساب Google أول مرة؛ الشيت الحالي غير مُصرّح به.",
      409,
    );
  const ts = Math.floor(Date.now() / 1000),
    nonce = crypto.randomUUID().replaceAll("-", ""),
    payload = "{}",
    operation = "snapshot";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode([ts, nonce, operation, payload].join("\n")),
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const r = await fetch(config.url, {
    method: "POST",
    body: JSON.stringify({
      action: "wasl",
      operation,
      ts,
      nonce,
      payload,
      signature,
    }),
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) fail("تعذر الاتصال بالشيت", 502);
  const snapshot = await r.json();
  if (!snapshot.ok || !Array.isArray(snapshot.orders))
    fail("الشيت رفض الاتصال؛ راجع صلاحية الربط", 502);
  return snapshot.orders;
}
async function syncSheet(w: string, id: string, snapshot?: any[]) {
  const rows = snapshot || (await signedSnapshot(w, id));
  const cleaned = rows
    .map((r: any) => ({
      ...r,
      phone: phone(String(r.phone || r.rawPhone || "")),
      status: sheetStatus(String(r.rawStatus || r.status || "")),
      tracking: tracking(String(r.tracking || "")),
      amount: Number(r.amount),
    }))
    .filter(
      (r: any) =>
        r.status &&
        r.phone &&
        (!r.currency || r.currency === "EGP") &&
        Number.isFinite(r.amount) &&
        r.amount >= 0,
    );
  const result = check(
    await db.rpc("merge_sheet", { p_workspace: w, p_rows: cleaned }),
  );
  const c = check(
    await db
      .from("sheet_connections")
      .select("interval_minutes")
      .eq("workspace_id", w)
      .single(),
  );
  check(
    await db
      .from("sheet_connections")
      .update({
        last_success: new Date().toISOString(),
        last_error: null,
        last_count: cleaned.length,
        locked_until: null,
        next_run: new Date(
          Date.now() + c.interval_minutes * 60000,
        ).toISOString(),
      })
      .eq("workspace_id", w),
  );
  check(await db.rpc("apply_postal", { p_workspace: w }));
  return {
    ok: true,
    ...result,
    unrecognized: rows.length - cleaned.length,
    total: rows.length,
  };
}
async function cleanup() {
  const jobs = check(
    await db
      .from("retention_jobs")
      .select("*")
      .eq("status", "pending")
      .lte("next_attempt", new Date().toISOString())
      .order("created_at")
      .limit(100),
  );
  for (const j of jobs) {
    const state = check(await db.rpc("prepare_file_removal", { p_job: j.id }));
    if (state.skip) continue;
    if (state.delete_object) {
      const { error } = await db.storage.from("waybills").remove([state.path]);
      if (error) {
        await db
          .from("retention_jobs")
          .update({
            error: "تعذر حذف الملف؛ ستتم إعادة المحاولة",
            next_attempt: new Date(Date.now() + 900000).toISOString(),
          })
          .eq("id", j.id);
        continue;
      }
    }
    check(
      await db
        .from("retention_jobs")
        .update({ status: "done", error: null })
        .eq("id", j.id),
    );
  }
  return jobs.length;
}
async function tick() {
  const jobs = check(await db.rpc("claim_sheet_jobs"));
  for (const j of jobs) {
    try {
      await syncSheet(j.workspace_id, j.sheet_id);
    } catch (e) {
      await db
        .from("sheet_connections")
        .update({
          last_error: (e as Error).message,
          locked_until: null,
          next_run: new Date(
            Date.now() + j.interval_minutes * 60000,
          ).toISOString(),
        })
        .eq("workspace_id", j.workspace_id);
    }
  }
  check(await db.rpc("prepare_maintenance"));
  await cleanup();
  const push = await sendPush(db, secret);
  return { ok: true, sheets: jobs.length, push };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  try {
    const url = new URL(req.url);
    const action = url.pathname.split("/").filter(Boolean).pop();
    let b: any = {};
    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 2500000) fail("حجم الطلب كبير", 413);
      try {
        b = JSON.parse(raw);
      } catch {
        fail("بيانات غير صحيحة");
      }
    }
    if (action === "bootstrap") {
      const hash = await digest(String(b.token));
      if (!check(await db.rpc("claim_bootstrap", { p_hash: hash })))
        fail("رابط الإعداد غير صالح", 403);
      const username = String(b.username || "ahmed")
        .normalize("NFKC")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail("اسم المستخدم غير صحيح");
      const email = username + "@users.wasl.invalid";
      const r = await db.auth.admin.createUser({
        email,
        password: b.password,
        email_confirm: true,
      });
      if (r.error) fail("تعذر إعداد المدير", 500);
      check(
        await db.from("profiles").insert({
          id: r.data.user.id,
          workspace_id: b.workspace,
          username,
          role: "admin",
        }),
      );
      return reply({ ok: true });
    }
    if (action === "tick") {
      const expected = await secret("cron");
      if (
        !expected ||
        req.headers.get("Authorization") !== "Bearer " + expected
      )
        fail("Unauthorized", 401);
      return reply(await tick());
    }
    if (action === "health") {
      const d = await device(req);
      return reply({ ok: true, scope: "postal", expiresAt: d.expires_at });
    }
    if (action === "postal") {
      const d = await device(req);
      return reply(await ingest(d.workspace_id, b.events, "android"));
    }
    if (action === "alerts") {
      const d = await device(req);
      const cursor = url.searchParams.get("cursor") || "0";
      if (!/^\d+$/.test(cursor)) fail("مؤشر غير صالح");
      const rows = check(
        await db
          .from("notifications")
          .select("id,title,body")
          .eq("workspace_id", d.workspace_id)
          .gt("id", cursor)
          .order("id")
          .limit(50),
      );
      return reply({
        ok: true,
        alerts: rows.map((r: any) => ({ ...r, id: String(r.id) })),
        cursor: String(rows.at(-1)?.id || cursor),
        hasMore: rows.length === 50,
      });
    }
    if (action === "fcm") {
      const d = await device(req);
      if (typeof b.fcmToken !== "string" || b.fcmToken.length > 4096)
        fail("رمز تنبيهات غير صحيح");
      check(
        await db.rpc("register_device_fcm", {
          p_device: d.id,
          p_token: b.fcmToken,
        }),
      );
      return reply({ ok: true });
    }
    const p = await member(req),
      w = p.workspace_id;
    if (action === "postal-import")
      return reply(await ingest(w, b.events, "manual"));
    if (action === "postal-rematch")
      return reply({
        ok: true,
        applied: check(await db.rpc("apply_postal", { p_workspace: w })),
      });
    if (action === "pair") {
      const token = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      check(
        await db.from("devices").insert({
          workspace_id: w,
          name: String(b.name || "هاتف وصل").slice(0, 100),
          token_hash: await digest(token),
        }),
      );
      return reply({ ok: true, token });
    }
    if (action === "revoke") {
      await admin(req);
      check(
        await db
          .from("devices")
          .update({ revoked_at: new Date().toISOString(), fcm_token: null })
          .eq("workspace_id", w)
          .eq("id", b.id),
      );
      return reply({ ok: true });
    }
    if (action === "sheet-connect") {
      await admin(req);
      const id = sheetId(String(b.url));
      if (!id) fail("أدخل رابط Google Sheets الصحيح");
      const minutes = Number(b.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
        fail("اختار من دقيقة إلى 1440 دقيقة");
      const snapshot = await signedSnapshot(w, id);
      check(
        await db.from("sheet_connections").upsert({
          workspace_id: w,
          sheet_id: id,
          interval_minutes: minutes,
          enabled: !!b.enabled,
          next_run: new Date().toISOString(),
        }),
      );
      try {
        return reply(await syncSheet(w, id, snapshot));
      } catch (e) {
        await db
          .from("sheet_connections")
          .update({ last_error: (e as Error).message })
          .eq("workspace_id", w);
        throw e;
      }
    }
    if (action === "sheet-sync") {
      await admin(req);
      const c = check(
        await db
          .from("sheet_connections")
          .select("*")
          .eq("workspace_id", w)
          .single(),
      );
      return reply(await syncSheet(w, c.sheet_id));
    }
    if (action === "create-user") {
      await admin(req);
      const username = String(b.username)
        .normalize("NFKC")
        .trim()
        .toLowerCase();
      if (
        !/^[a-z0-9._-]{3,40}$/.test(username) ||
        String(b.password).length < 6
      )
        fail(
          "اسم المستخدم بالإنجليزية من 3 حروف؛ كلمة المرور 6 أحرف على الأقل",
        );
      const r = await db.auth.admin.createUser({
        email: username + "@users.wasl.invalid",
        password: b.password,
        email_confirm: true,
      });
      if (r.error) fail("تعذر إنشاء المستخدم؛ قد يكون الاسم مستخدمًا");
      const profile = await db.from("profiles").insert({
        id: r.data.user.id,
        workspace_id: w,
        username,
        role: "member",
      });
      if (profile.error) {
        await db.auth.admin.deleteUser(r.data.user.id);
        fail("تعذر إنشاء المستخدم");
      }
      return reply({ ok: true });
    }
    if (action === "cleanup") {
      await admin(req);
      return reply({ ok: true, processed: await cleanup() });
    }
    fail("المسار غير موجود", 404);
  } catch (e) {
    return reply(
      { ok: false, error: (e as Error).message },
      (e as any).status || 500,
    );
  }
});
