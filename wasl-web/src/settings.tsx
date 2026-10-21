import { useEffect, useRef, useState } from "react";
import {
  Link,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  UserPlus,
  Bell,
} from "lucide-react";
import { db, call, checked, date } from "./api";
declare global {
  interface Window {
    WaslDevice?: { postMessage: (s: string) => void };
    __waslPairRequestId?: string;
  }
}
export function Integrations({
  profile,
  notify,
}: {
  profile: { workspace_id: string; role: string };
  notify: (s: string) => void;
}) {
  const [c, setC] = useState<any>(null),
    [s, setS] = useState<any>(null),
    [devices, setDevices] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [nonce, setNonce] = useState(window.__waslPairRequestId);
  const pairingRequested = useRef(false);
  const admin = profile.role === "admin";
  async function load() {
    const r = await Promise.all([
      db.from("sheet_connections").select("*").maybeSingle(),
      db.from("settings").select("*").single(),
      db
        .from("devices")
        .select("id,name,last_seen_at,expires_at,revoked_at")
        .order("created_at", { ascending: false }),
    ]);
    for (const x of r) if (x.error) notify(x.error.message);
    setC(r[0].data);
    setS(r[1].data);
    setDevices(r[2].data || []);
  }
  useEffect(() => {
    void load();
    const h = (e: Event) => {
      const requestId = (e as CustomEvent).detail.requestId;
      setNonce(requestId);
      if (pairingRequested.current) {
        pairingRequested.current = false;
        void run(() => pairPhone(requestId));
      }
    };
    window.addEventListener("wasl-pair-request", h);
    return () => window.removeEventListener("wasl-pair-request", h);
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pairPhone(requestId: string) {
    if (!window.WaslDevice) throw Error("افتح وصل من تطبيق أندرويد");
    const r = await call("pair", { name: "هاتف وصل" });
    window.WaslDevice.postMessage(
      JSON.stringify({ type: "paired", requestId, postalToken: r.token }),
    );
    notify("جاري ربط الهاتف والتحقق منه");
  }
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">كل حاجة متوصلة</div>
        <h1>الربط والإعدادات</h1>
        <p>اختار المزامنة والتنبيهات بالطريقة اللي تناسب شغلك.</p>
      </div>
      <div className="settings-grid">
        <section className="panel padded">
          <div className="section-title">
            <h2>
              <Link size={21} /> Google Sheets
            </h2>
            <span
              className={"badge " + (c?.last_success ? "confirmed" : "new")}
            >
              {c?.last_success ? "متصل" : "لم يُربط بعد"}
            </span>
          </div>
          <p className="muted">
            الطلبات تفضل تيجي في الشيت وتليجرام، ووصل يقرأ نسخة منها ويحدّث
            الحالات المؤكدة.
          </p>
          <form
            key={c?.sheet_id || "new"}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const r = await call("sheet-connect", {
                  url: f.get("url"),
                  minutes: Number(f.get("minutes")),
                  enabled: f.get("enabled") === "on",
                });
                notify(
                  `تمت المزامنة: ${r.inserted} جديد، ${r.updated} محدث، ${r.skipped + r.unrecognized} يحتاج مراجعة`,
                );
              });
            }}
          >
            <label>
              رابط الشيت
              <input
                name="url"
                type="url"
                dir="ltr"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                defaultValue={
                  c
                    ? "https://docs.google.com/spreadsheets/d/" +
                      c.sheet_id +
                      "/edit"
                    : ""
                }
                required
                disabled={!admin}
              />
            </label>
            <div className="form-grid">
              <label>
                المزامنة كل كام دقيقة؟
                <input
                  name="minutes"
                  type="number"
                  min="1"
                  max="1440"
                  defaultValue={c?.interval_minutes || 5}
                  disabled={!admin}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={c?.enabled}
                  disabled={!admin}
                />{" "}
                تفعيل المزامنة التلقائية
              </label>
            </div>
            <p className="hint">
              الشيت الخاص الحالي يتربط بالوصلة المصرّح بها. أي شيت خاص جديد
              يحتاج منح صلاحية Google أول مرة.
            </p>
            {c?.last_error && <p className="error">{c.last_error}</p>}
            <div className="button-row">
              <button className="primary" disabled={busy || !admin}>
                تحقق واحفظ الربط
              </button>
              <button
                type="button"
                disabled={!c || busy || !admin}
                onClick={() =>
                  void run(async () => {
                    const r = await call("sheet-sync");
                    notify(`اتقرا ${r.total} طلب من الشيت`);
                  })
                }
              >
                <RefreshCw size={17} /> مزامنة الآن
              </button>
            </div>
            <p className="hint">
              آخر نجاح: {date(c?.last_success)} · {c?.last_count || 0} طلب
            </p>
          </form>
        </section>
        <section className="panel padded">
          <h2>
            <Smartphone size={21} /> ربط هاتف أندرويد
          </h2>
          <p className="muted">
            الهاتف يرسل إشعارات البريد الجديدة تلقائيًا، ويستورد الرسائل القديمة
            على دفعات حتى نهاية الوارد.
          </p>
          <ol className="steps">
            <li>افتح وصل من تطبيق أندرويد وسجّل الدخول.</li>
            <li>اضغط «ربط هذا الهاتف».</li>
            <li>فعّل وصول الإشعارات وإذن الرسائل من صفحة الأذونات.</li>
          </ol>
          <button
            className="primary"
            disabled={busy || !window.WaslDevice}
            onClick={() => {
              if (nonce) void run(() => pairPhone(nonce));
              else if (window.WaslDevice) {
                pairingRequested.current = true;
                window.WaslDevice.postMessage(
                  JSON.stringify({ type: "requestPair" }),
                );
                notify("جاري تجهيز الربط المباشر");
              }
            }}
          >
            ربط هذا الهاتف
          </button>
          {!window.WaslDevice && (
            <p className="hint">
              الربط المباشر يظهر داخل نسخة أندرويد الجديدة. المتصفح يعرض حالة
              الأجهزة فقط.
            </p>
          )}
          {devices.map((d) => (
            <div className="list-row" key={d.id}>
              <ShieldCheck size={18} />
              <div className="grow">
                <strong>{d.name}</strong>
                <small>
                  {d.revoked_at
                    ? "تم إلغاء الربط"
                    : d.last_seen_at
                      ? "آخر اتصال: " + date(d.last_seen_at)
                      : "في انتظار أول اتصال"}
                </small>
              </div>
              {admin && !d.revoked_at && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call("revoke", { id: d.id });
                      notify("اتلغى ربط الهاتف");
                    })
                  }
                >
                  إلغاء
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
      {s && (
        <section className="panel padded section-gap">
          <h2>
            <Bell size={21} /> قواعد المتابعة والتنبيهات
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                checked(
                  await db
                    .from("settings")
                    .update({
                      confirm_days: Number(f.get("confirm")),
                      ship_days: Number(f.get("ship")),
                      notify_new: f.get("new") === "on",
                      notify_old: f.get("old") === "on",
                      automatic_postal: f.get("postal") === "on",
                    })
                    .eq("workspace_id", profile.workspace_id),
                );
                notify("اتحفظت قواعد التنبيهات");
              });
            }}
          >
            <div className="form-grid">
              <label>
                مؤكد ولم يُشحن بعد كام يوم؟
                <input
                  name="confirm"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue={s.confirm_days}
                />
              </label>
              <label>
                مشحون ولم يُسلّم بعد كام يوم؟
                <input
                  name="ship"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue={s.ship_days}
                />
              </label>
            </div>
            <label className="check">
              <input name="new" type="checkbox" defaultChecked={s.notify_new} />{" "}
              تنبيهات على الطلبات الجديدة
            </label>
            <label className="check">
              <input name="old" type="checkbox" defaultChecked={s.notify_old} />{" "}
              تنبيهات على الطلبات المستوردة القديمة
            </label>
            <label className="check">
              <input
                name="postal"
                type="checkbox"
                defaultChecked={s.automatic_postal}
              />{" "}
              اعتماد رسائل البريد المطابقة تلقائيًا برقم الشحنة
            </label>
            <button className="primary" disabled={busy || !admin}>
              حفظ الاختيارات
            </button>
          </form>
        </section>
      )}
      {admin && (
        <section className="panel padded section-gap">
          <h2>
            <UserPlus size={21} /> إضافة مستخدم
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void run(async () => {
                await call("create-user", {
                  username: f.get("username"),
                  password: f.get("password"),
                });
                notify("اتضاف المستخدم");
                form.reset();
              });
            }}
          >
            <div className="form-grid">
              <label>
                اسم المستخدم
                <input
                  name="username"
                  dir="ltr"
                  autoComplete="off"
                  pattern="[a-zA-Z0-9._-]{3,40}"
                  required
                />
              </label>
              <label>
                كلمة المرور
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </label>
            </div>
            <p className="hint">
              اسم المستخدم لا يفرق بين الحروف الكبيرة والصغيرة.
            </p>
            <button disabled={busy}>إضافة مستخدم</button>
          </form>
        </section>
      )}
    </>
  );
}
