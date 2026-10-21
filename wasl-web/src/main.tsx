import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import {
  Package,
  Files,
  MessageSquare,
  Settings,
  LogOut,
  ArrowLeft,
  Plus,
  Search,
  Bell,
  RefreshCw,
  CheckCircle,
  Truck,
  Clock,
  LayoutDashboard,
} from "lucide-react";
import { db, checked, date, Order } from "./api";
import { phone, plain, statuses, Status } from "../shared/domain";
import { Integrations } from "./settings";
import { Bills } from "./bills";
import { Messages } from "./messages";
import { Storage } from "./storage";
import "./style.css";
type Profile = {
  id: string;
  workspace_id: string;
  username: string;
  role: string;
};
const tabs = [
  ["overview", "نظرة عامة", LayoutDashboard],
  ["orders", "الطلبات", Package],
  ["bills", "البوالص", Files],
  ["messages", "رسائل البريد", MessageSquare],
  ["settings", "الربط والإعدادات", Settings],
  ["storage", "الملفات", Files],
] as const;
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [profile, setProfile] = useState<Profile | null>(null),
    [tab, setTab] = useState("overview"),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = db.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setProfile((p) => (p?.id === s?.user.id ? p : null));
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    db.from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then((r) => {
        if (!active) return;
        if (r.error) setError("حسابك لم يُربط بمساحة العمل بعد");
        else setProfile(r.data);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(id);
  }, [notice]);
  const refresh = () => setRevision((n) => n + 1);
  if (!ready) return <div className="loading">جاري فتح وصل…</div>;
  if (!session) return <Login />;
  if (!profile)
    return (
      <div className="loading">
        {error || "جاري تحميل حسابك…"}{" "}
        <button onClick={() => void db.auth.signOut()}>خروج</button>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("overview");
          }}
        >
          <span className="brand-icon">
            <Package />
          </span>
          <span>
            وصل<small>كل طلب، في مكانه.</small>
          </span>
        </a>
        <div className="workspace-label">مساحة العمل</div>
        <nav aria-label="التنقل الرئيسي">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              data-wasl-page={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "messages" && <span className="dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">A</div>
          <div>
            <strong>{profile.username}</strong>
            <small>
              {profile.role === "admin" ? "مدير النظام" : "عضو الفريق"}
            </small>
          </div>
          <button
            aria-label="تسجيل الخروج"
            onClick={() => void db.auth.signOut()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              مساحة العمل <ArrowLeft size={13} />{" "}
              {tabs.find((t) => t[0] === tab)?.[1]}
            </span>
            <span className="online">
              <i style={{ background: online ? "#439064" : "#ba8d55" }} />{" "}
              {online ? "متصل بالشبكة" : "بدون اتصال"}
            </span>
          </div>
          <button
            onClick={refresh}
            className="icon-button"
            aria-label="تحديث البيانات"
          >
            <RefreshCw size={19} />
          </button>
        </header>
        <div className="content">
          {notice && (
            <div className="toast" role="status">
              {notice}
              <button aria-label="إغلاق" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {tab === "overview" && (
            <Overview revision={revision} openOrders={() => setTab("orders")} />
          )}{" "}
          {tab === "orders" && (
            <Orders
              profile={profile}
              revision={revision}
              refresh={refresh}
              notify={setNotice}
            />
          )}{" "}
          {tab === "bills" && (
            <Bills
              workspace={profile.workspace_id}
              notify={setNotice}
              refresh={refresh}
            />
          )}{" "}
          {tab === "messages" && (
            <Messages notify={setNotice} refresh={refresh} />
          )}{" "}
          {tab === "settings" && (
            <Integrations profile={profile} notify={setNotice} />
          )}{" "}
          {tab === "storage" && (
            <Storage profile={profile} notify={setNotice} />
          )}
        </div>
        <footer>وصل • مساحة واحدة للطلبات والشحن</footer>
      </main>
    </div>
  );
}
function Login() {
  const [user, setUser] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="login">
      <div className="login-art">
        <Package size={54} />
        <h1>
          من أول طلب
          <br />
          لحد باب العميل.
        </h1>
        <p>تابع طلباتك، اربط شحناتك، واعرف اللي محتاج متابعة.</p>
        <span>وصل · إدارة الطلبات ببساطة</span>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const normalized = plain(user);
            const username =
              normalized === "احمد"
                ? "ahmed"
                : user.normalize("NFKC").trim().toLowerCase();
            const r = await db.auth.signInWithPassword({
              email: username + "@users.wasl.invalid",
              password,
            });
            if (r.error) throw Error("اسم المستخدم أو كلمة المرور غير صحيحة");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand">
          <span className="brand-icon">
            <Package />
          </span>
          وصل
        </div>
        <h2>أهلًا برجوعك</h2>
        <p className="muted">سجّل دخولك لمتابعة شغلك.</p>
        <label>
          اسم المستخدم
          <input
            dir="ltr"
            autoComplete="username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            required
          />
        </label>
        <label>
          كلمة المرور
          <input
            dir="ltr"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <p className="hint">
          جلسة الدخول محفوظة على جهازك لحد ما تختار تسجيل الخروج.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "جاري الدخول…" : "تسجيل الدخول"} <ArrowLeft size={18} />
        </button>
      </form>
    </div>
  );
}
function Overview({
  revision,
  openOrders,
}: {
  revision: number;
  openOrders: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    db.rpc("dashboard").then((r) => {
      if (!active) return;
      if (r.error) setError(r.error.message);
      else setData(r.data);
    });
    return () => {
      active = false;
    };
  }, [revision]);
  const stats = [
    ["كل الطلبات", data?.total || 0, Package, "purple"],
    ["طلبات مؤكدة", data?.confirmed || 0, CheckCircle, "green"],
    ["في الطريق", data?.shipped || 0, Truck, "blue"],
    ["تم التسليم", data?.delivered || 0, CheckCircle, "orange"],
  ];
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">متابعة يومك</div>
        <h1>
          شغلك واضح، خطوة بخطوة<span className="heading-dot">.</span>
        </h1>
        <p>كل الطلبات والشحنات اللي محتاجة انتباهك، قدامك.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="stats">
        {stats.map(([label, count, Icon, color]: any) => (
          <div className="stat" key={label}>
            <div>
              <span className={"stat-icon " + color}>
                <Icon size={21} />
              </span>
              <small>الطلبات</small>
            </div>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="section-title">
            <h2>
              <Clock size={20} /> محتاج متابعة
            </h2>
            <button className="text" onClick={openOrders}>
              عرض الطلبات <ArrowLeft size={16} />
            </button>
          </div>
          {data?.overdue?.length ? (
            data.overdue.map((o: any) => (
              <div className="list-row" key={o.id}>
                <div className="avatar warm">{o.name.slice(0, 1)}</div>
                <div className="grow">
                  <strong>{o.name}</strong>
                  <small>{o.code}</small>
                </div>
                <span className={"badge " + o.status}>
                  {statuses[o.status as Status]}
                </span>
              </div>
            ))
          ) : (
            <div className="empty">
              <CheckCircle size={34} />
              <h3>المتابعة تحت السيطرة</h3>
              <p>الطلبات اللي تعدّي المدة المحددة هتظهر هنا.</p>
            </div>
          )}
        </section>
        <section className="panel soft">
          <div className="section-title">
            <h2>
              <Bell size={20} /> آخر التنبيهات
            </h2>
          </div>
          {data?.alerts?.length ? (
            data.alerts.map((a: any) => (
              <div className="alert-row" key={a.id}>
                <span className="tiny-dot" />
                <div>
                  <strong>{a.title}</strong>
                  <p>{a.body}</p>
                  <small>{date(a.created_at)}</small>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">
              <Bell size={30} />
              <h3>مفيش تنبيهات جديدة</h3>
              <p>هتوصلك تنبيهات التأخير حسب اختياراتك.</p>
            </div>
          )}
        </section>
      </div>
      <div className="note-strip">
        <Files size={23} />
        <div>
          <strong>بوليصة واحدة، متابعة كاملة</strong>
          <p>
            ارفع البوالص، واربطها برقم العميل. رسائل البريد هتكمل حالة الشحنة.
          </p>
        </div>
        <button className="secondary" onClick={openOrders}>
          افتح الطلبات <ArrowLeft size={16} />
        </button>
      </div>
    </>
  );
}
function Orders({
  profile,
  revision,
  refresh,
  notify,
}: {
  profile: Profile;
  revision: number;
  refresh: () => void;
  notify: (s: string) => void;
}) {
  const [rows, setRows] = useState<Order[]>([]),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<Order | null>(null),
    [add, setAdd] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    let q = db
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id")
      .range(page * 40, page * 40 + 39);
    if (status) q = q.eq("status", status);
    if (search) {
      const s = search.replace(/[%(),.]/g, "").slice(0, 100);
      q = q.or(
        `name.ilike.%${s}%,code.ilike.%${s}%,tracking.ilike.%${s}%,phone.ilike.%${phone(s) || s}%`,
      );
    }
    q.then((r) => {
      if (!active) return;
      if (r.error) notify(r.error.message);
      else {
        setRows(r.data as Order[]);
        setTotal(r.count || 0);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [page, search, status, revision]);
  return (
    <>
      <div className="page-heading split">
        <div>
          <div className="eyebrow">إدارة الطلبات</div>
          <h1>كل طلباتك</h1>
          <p>{total} طلب · من التسجيل لحد التسليم</p>
        </div>
        <button className="primary" onClick={() => setAdd(true)}>
          <Plus size={18} /> إضافة طلب
        </button>
      </div>
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={19} />
            <input
              aria-label="البحث عن طلب"
              placeholder="اسم العميل، التليفون، كود الطلب أو الشحنة…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="تصفية الحالة"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">كل الحالات</option>
            {Object.entries(statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>العميل</th>
                <th>الطلب</th>
                <th>الحالة</th>
                <th>الشحنة</th>
                <th>القيمة</th>
                <th>تاريخ الطلب</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} onClick={() => setSelected(o)}>
                  <td>
                    <button
                      className="customer text"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(o);
                      }}
                    >
                      <span className="avatar">{o.name.slice(0, 1)}</span>
                      <span>
                        {o.name}
                        <small dir="ltr">{o.phone}</small>
                      </span>
                    </button>
                  </td>
                  <td className="mono">{o.code}</td>
                  <td>
                    <span className={"badge " + o.status}>
                      {statuses[o.status]}
                    </span>
                  </td>
                  <td className="mono">{o.tracking || "—"}</td>
                  <td>
                    {o.amount} <small>ج.م</small>
                  </td>
                  <td>
                    {o.created_at
                      ? new Date(o.created_at).toLocaleDateString("ar-EG")
                      : "غير محدد"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p className="center muted">جاري التحميل…</p>}
        {!loading && !rows.length && (
          <div className="empty">
            <Package size={34} />
            <h3>مفيش طلبات هنا لسه</h3>
            <p>أضف طلب أو اربط شيت Google من الإعدادات.</p>
          </div>
        )}
        <div className="pagination">
          <span>
            عرض {rows.length} من {total}
          </span>
          <div>
            <button disabled={!page} onClick={() => setPage((n) => n - 1)}>
              السابق
            </button>
            <span>{page + 1}</span>
            <button
              disabled={(page + 1) * 40 >= total}
              onClick={() => setPage((n) => n + 1)}
            >
              التالي
            </button>
          </div>
        </div>
      </section>
      {(selected || add) && (
        <OrderDialog
          order={selected}
          workspace={profile.workspace_id}
          close={() => {
            setSelected(null);
            setAdd(false);
          }}
          saved={() => {
            refresh();
            setSelected(null);
            setAdd(false);
          }}
          notify={notify}
        />
      )}
    </>
  );
}
function OrderDialog({
  order,
  workspace,
  close,
  saved,
  notify,
}: {
  order: Order | null;
  workspace: string;
  close: () => void;
  saved: () => void;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [bills, setBills] = useState<any[]>([]);
  useEffect(() => {
    if (order)
      db.from("file_archive")
        .select("*")
        .eq("order_id", order.id)
        .is("deleted_at", null)
        .then((r) => setBills(r.data || []));
  }, [order]);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={order ? "تفاصيل الطلب" : "إضافة طلب"}
      >
        <div className="section-title">
          <h2>{order ? "تفاصيل الطلب" : "إضافة طلب يدوي"}</h2>
          <button onClick={close} aria-label="إغلاق">
            ×
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const f = new FormData(e.currentTarget),
                p = phone(String(f.get("phone"))),
                s = String(f.get("status")) as Status;
              if (!p) throw Error("رقم موبايل مصري غير صحيح");
              const now = new Date().toISOString();
              const patch = {
                name: String(f.get("name")),
                phone: p,
                address: String(f.get("address")),
                product: String(f.get("product")),
                amount: Number(f.get("amount")),
                notes: String(f.get("notes")),
                status: s,
                updated_at: now,
                ...(!order?.confirmed_at &&
                s === "confirmed" &&
                order?.status !== s
                  ? { confirmed_at: now }
                  : {}),
                ...(!order?.shipped_at && s === "shipped" && order?.status !== s
                  ? { shipped_at: now }
                  : {}),
                ...(!order?.delivered_at &&
                s === "delivered" &&
                order?.status !== s
                  ? { delivered_at: now }
                  : {}),
              };
              if (order) {
                const changed =
                  patch.name !== order.name ||
                  patch.phone !== order.phone ||
                  patch.address !== order.address ||
                  patch.product !== order.product ||
                  patch.amount !== Number(order.amount);
                Object.assign(patch, {
                  details: {
                    ...order.details,
                    manualCustomer:
                      f.get("resume_sheet") === "on"
                        ? false
                        : !!order.details?.manualCustomer || changed,
                  },
                });
              }
              const suppliedDate = String(f.get("state_date") || "");
              if (suppliedDate) {
                const parsed = new Date(suppliedDate);
                if (
                  !Number.isFinite(parsed.getTime()) ||
                  parsed.getTime() > Date.now() + 60000
                )
                  throw Error("اختار تاريخ حالة صحيحًا غير مستقبلي");
                const field = {
                  confirmed: "confirmed_at",
                  shipped: "shipped_at",
                  delivered: "delivered_at",
                }[s as "confirmed" | "shipped" | "delivered"];
                if (!field)
                  throw Error("تاريخ الحالة متاح للتأكيد والشحن والتسليم");
                Object.assign(patch, { [field]: parsed.toISOString() });
              }
              if (order)
                checked(
                  await db.from("orders").update(patch).eq("id", order.id),
                );
              else
                checked(
                  await db.from("orders").insert({
                    ...patch,
                    workspace_id: workspace,
                    code: "W-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
                  }),
                );
              notify("اتحفظ الطلب");
              saved();
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            اسم العميل
            <input name="name" defaultValue={order?.name} required />
          </label>
          <label>
            رقم الموبايل
            <input
              name="phone"
              dir="ltr"
              inputMode="tel"
              defaultValue={order?.phone}
              required
            />
          </label>
          <label>
            العنوان
            <input name="address" defaultValue={order?.address} />
          </label>
          <div className="form-grid">
            <label>
              المنتج
              <input name="product" defaultValue={order?.product} />
            </label>
            <label>
              القيمة
              <input
                name="amount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={order?.amount || 0}
              />
            </label>
          </div>
          <label>
            الحالة
            <select name="status" defaultValue={order?.status || "new"}>
              {Object.entries(statuses)
                .filter(([k]) => k !== "shipped" || order?.tracking)
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </label>
          <label>
            تاريخ الحالة — اختياري للطلبات القديمة
            <input type="datetime-local" name="state_date" />
          </label>
          {order?.details?.manualCustomer && (
            <label className="check">
              <input type="checkbox" name="resume_sheet" />
              السماح للشيت بتحديث بيانات العميل بدل التعديل اليدوي
            </label>
          )}
          <label>
            ملاحظات
            <textarea name="notes" defaultValue={order?.notes} />
          </label>
          {order?.details?.finance && (
            <div className="archive-finance">{order.details.finance}</div>
          )}
          {order?.tracking && (
            <p className="mono" dir="ltr">
              {order.tracking} • {order.carrier_status}
            </p>
          )}
          {bills.map((b) => (
            <button
              type="button"
              key={b.id}
              className="file-link"
              onClick={async () => {
                try {
                  const r = checked(
                    await db.storage
                      .from("waybills")
                      .createSignedUrl(b.path, 60),
                  );
                  window.open(r.signedUrl, "_blank", "noopener");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <Files size={17} />
              {b.file_name}
            </button>
          ))}
          <div className="dialog-actions">
            <button type="button" onClick={close}>
              إلغاء
            </button>
            <button className="primary" disabled={busy}>
              حفظ الطلب
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="loading">
        حصل خطأ في عرض الصفحة.{" "}
        <button onClick={() => location.reload()}>إعادة التحميل</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
