import { useEffect, useState } from "react";
import { Upload, MessageSquare, RefreshCw } from "lucide-react";
import { db, call, date } from "./api";
export function Messages({
  notify,
  refresh,
}: {
  notify: (s: string) => void;
  refresh: () => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<any[]>([]),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [onlyPending, setOnlyPending] = useState(false),
    [rev, setRev] = useState(0);
  useEffect(() => {
    let active = true;
    let q = db
      .from("postal_events")
      .select("*", { count: "exact" })
      .order("imported_at", { ascending: false })
      .order("id")
      .range(page * 40, page * 40 + 39);
    if (onlyPending) q = q.is("order_id", null);
    q.then((r) => {
      if (active) {
        setRows(r.data || []);
        setTotal(r.count || 0);
        if (r.error) notify(r.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [page, onlyPending, rev]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setRev((n) => n + 1);
      refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">صندوق البريد</div>
        <h1>الرسائل وحالات الشحن</h1>
        <p>
          المطابقة برقم الشحنة. الرسائل غير المطابقة محفوظة لحد ما تترفع
          البوليصة.
        </p>
      </div>
      <section className="panel padded">
        <h2>
          <Upload size={20} /> إضافة رسائل أو سكرين شوت
        </h2>
        <div className="form-grid">
          <div>
            <label>
              نص الرسائل
              <textarea
                rows={6}
                placeholder="الصق الرسائل هنا؛ كل رسالة تبدأ بعميلنا العزيز…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !text.trim()}
              onClick={() =>
                void run(async () => {
                  const r = await call("postal-import", { events: [{ text }] });
                  notify(
                    `اتقرا ${r.parsed} رقم شحنة، واتربط ${r.applied} تحديث`,
                  );
                  setText("");
                })
              }
            >
              قراءة وحفظ الرسائل
            </button>
          </div>
          <div className="upload-box">
            <MessageSquare size={32} />
            <strong>سكرين شوت رسائل البريد</strong>
            <p>القراءة بتتم على جهازك. اختار صورة واضحة تشمل رقم الشحنة.</p>
            <label className="upload-button">
              اختيار صور
              <input
                type="file"
                multiple
                accept="image/*"
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  void run(async () => {
                    const { postalImageText } = await import("./ocr");
                    const results: string[] = [];
                    for (const f of files)
                      results.push(await postalImageText(f, notify));
                    setText((t) =>
                      [t, ...results].filter(Boolean).join("\n\n"),
                    );
                    notify(
                      "اتقرت الصور. راجع الأرقام والنص ثم اضغط قراءة وحفظ.",
                    );
                  });
                  e.target.value = "";
                }}
              />
            </label>
            <p className="hint">
              القراءة غير الواضحة تفضل للمراجعة، ومش هنعتمد تخمين لرقم شحنة.
            </p>
          </div>
        </div>
      </section>
      <section className="panel padded section-gap">
        <div className="section-title">
          <h2>
            سجل الرسائل <span className="count">{total}</span>
          </h2>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await call("postal-rematch");
                notify(
                  `اتربط ${r.applied} تحديث. الباقي محفوظ بدون تعديل الطلبات.`,
                );
              })
            }
          >
            <RefreshCw size={16} /> إعادة المطابقة
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => {
              setOnlyPending(e.target.checked);
              setPage(0);
            }}
          />{" "}
          اعرض غير المطابق فقط
        </label>
        {rows.map((r) => (
          <article className="message-card" key={r.id}>
            <div className="section-title">
              <strong className="mono" dir="ltr">
                {r.tracking}
              </strong>
              <span className={"badge " + (r.order_id ? "confirmed" : "new")}>
                {r.order_id ? "مرتبط بطلب" : "في انتظار بوليصة مطابقة"}
              </span>
            </div>
            <p>{r.text}</p>
            <small>
              {r.received_at
                ? "تاريخ الرسالة: " + date(r.received_at)
                : "تاريخ الرسالة غير متاح"}{" "}
              · أضيفت {date(r.imported_at)}
            </small>
          </article>
        ))}
        {!rows.length && (
          <div className="empty">
            <MessageSquare size={30} />
            <h3>لا توجد رسائل في العرض الحالي</h3>
          </div>
        )}
        <div className="pagination">
          <span>
            {rows.length} من {total}
          </span>
          <div>
            <button disabled={!page} onClick={() => setPage((n) => n - 1)}>
              السابق
            </button>
            <button
              disabled={(page + 1) * 40 >= total}
              onClick={() => setPage((n) => n + 1)}
            >
              التالي
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
