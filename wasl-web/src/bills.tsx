import { useEffect, useRef, useState } from "react";
import { Camera, Upload, CheckCheck, Files } from "lucide-react";
import { db, checked, Order } from "./api";
import { phone, tracking } from "../shared/domain";
import type { Page } from "./ocr";
function BillThumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        className="bill-thumb"
        src={url}
        alt="صورة البوليصة لمراجعة الرقم قبل القبول"
      />
    </a>
  ) : null;
}
function Archive({
  revision,
  notify,
}: {
  revision: number;
  notify: (s: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [file, setFile] = useState<any>(null),
    [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    db.from("file_archive")
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range(page * 30, page * 30 + 29)
      .then((r) => {
        if (active) {
          setRows(r.data || []);
          setTotal(r.count || 0);
          if (r.error) notify(r.error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [page, revision]);
  return (
    <section className="panel padded section-gap">
      <div className="section-title">
        <h2>
          <Files size={20} /> أرشيف البوالص{" "}
          <span className="count">{total}</span>
        </h2>
        <span className="hint">كل ملف محفوظ تحت طلب العميل</span>
      </div>
      {rows.map((r) => (
        <div className="list-row" key={r.id}>
          <Files size={18} />
          <div className="grow">
            <strong>{r.file_name}</strong>
            <small className="mono">
              {r.tracking || "مرفق قديم بدون رقم شحنة مسجل"}
            </small>
          </div>
          <button
            onClick={async () => {
              setFile(r);
              setUrl("");
              try {
                const link = checked(
                  await db.storage
                    .from("waybills")
                    .createSignedUrl(r.path, 300),
                );
                setUrl(link.signedUrl);
              } catch (e) {
                setFile(null);
                notify((e as Error).message);
              }
            }}
          >
            عرض
          </button>
        </div>
      ))}
      {!rows.length && (
        <div className="empty">
          <Files size={30} />
          <h3>أول بوليصة ليها مكان هنا</h3>
        </div>
      )}
      <div className="pagination">
        <span>
          {rows.length} من {total}
        </span>
        <div>
          <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
            السابق
          </button>
          <button
            disabled={(page + 1) * 30 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </button>
        </div>
      </div>
      {file && (
        <div className="modal-backdrop">
          <section
            className="modal file-modal"
            role="dialog"
            aria-modal="true"
            aria-label="عرض البوليصة"
          >
            <div className="section-title">
              <h2>{file.file_name}</h2>
              <button aria-label="إغلاق" onClick={() => setFile(null)}>
                ×
              </button>
            </div>
            {!url ? (
              <p>جاري فتح الملف…</p>
            ) : (
              <>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="upload-button"
                >
                  فتح الملف أو تنزيله
                </a>
                {/\.pdf$/i.test(file.file_name) ? (
                  <iframe title="البوليصة" src={url} />
                ) : (
                  <img
                    className="document-preview"
                    src={url}
                    alt="البوليصة المحفوظة"
                  />
                )}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
type Draft = Page & {
  id: string;
  selectedPhone: string;
  order: Order | null;
  matches: number;
  state: "pending" | "saved" | "error" | "duplicate";
  error?: string;
  path?: string;
  hash?: string;
};
export function Bills({
  revision,
  workspace,
  notify,
  refresh,
}: {
  revision: number;
  workspace: string;
  notify: (s: string) => void;
  refresh: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    lock = useRef(false);
  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  async function match(p: string) {
    const n = phone(p);
    if (!n) return { order: null, matches: 0 };
    const rows = checked(
      await db
        .from("orders")
        .select("*")
        .eq("phone", n)
        .not("status", "in", "(cancelled,returned)")
        .limit(3),
    );
    return {
      order: rows.length === 1 ? (rows[0] as Order) : null,
      matches: rows.length,
    };
  }
  async function upload(files: File[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const { readFile } = await import("./ocr");
      for (const file of files) {
        const pages = await readFile(file, setProgress);
        for (const page of pages) {
          const matches = await Promise.all(
            page.phones.map(async (p) => ({ p, ...(await match(p)) })),
          );
          const found = matches.filter((x) => x.order);
          const selectedPhone =
            found.length === 1
              ? found[0].p
              : page.phones.length === 1
                ? page.phones[0]
                : "";
          const candidate =
            found.length === 1 ? found[0] : await match(selectedPhone);
          setDrafts((ds) => [
            ...ds,
            {
              ...page,
              id: crypto.randomUUID(),
              selectedPhone,
              order: candidate.order,
              matches: candidate.matches,
              state: "pending",
            },
          ]);
        }
      }
      notify("اتقرت الملفات. راجع رقم العميل والشحنة، واعتمد المطابق.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  async function accept(d: Draft, duplicate = "reject") {
    if (!d.order || !tracking(d.tracking || "")) return false;
    try {
      const sha = d.hash || (await (await import("./ocr")).hash(d.blob));
      const canonical = tracking(d.tracking!)!;
      if (d.order.tracking && d.order.tracking !== canonical) {
        update(d.id, {
          state: "error",
          error: "الطلب مرتبط برقم شحنة آخر؛ راجع الطلب قبل الربط",
        });
        return false;
      }
      const existing = checked(
        await db
          .from("waybills")
          .select("id,order_id")
          .eq("tracking", canonical)
          .maybeSingle(),
      );
      if (existing && existing.order_id !== d.order.id) {
        update(d.id, { state: "error", error: "البوليصة محفوظة تحت طلب آخر" });
        return false;
      }
      if (existing && duplicate !== "update") {
        update(d.id, {
          state: "duplicate",
          error: "البوليصة مرفوعة من قبل: اختار تحديث أو تجاهل",
        });
        return false;
      }
      let path = d.path;
      if (!path) {
        path = workspace + "/" + crypto.randomUUID() + ".png";
        checked(
          await db.storage.from("waybills").upload(path, d.blob, {
            contentType: d.blob.type || "image/png",
            upsert: false,
          }),
        );
        update(d.id, { path, hash: sha });
      }
      const r = checked(
        await db.rpc("accept_bill", {
          p_order: d.order.id,
          p_tracking: tracking(d.tracking!),
          p_path: path,
          p_hash: sha,
          p_name: d.name,
          p_duplicate: duplicate,
        }),
      );
      if (!r.ok) {
        update(d.id, {
          state: r.duplicate ? "duplicate" : "error",
          error: r.message,
        });
        return false;
      }
      update(d.id, { state: "saved", error: undefined });
      return true;
    } catch (e) {
      update(d.id, { state: "error", error: (e as Error).message });
      return false;
    }
  }
  async function batch(list: Draft[], duplicate = "reject") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    let saved = 0;
    try {
      for (const d of list) {
        setProgress("حفظ البوليصة " + (saved + 1) + " من " + list.length);
        if (await accept(d, duplicate)) saved++;
      }
      notify(
        `اتحفظ ${saved} من ${list.length}. البوالص غير المطابقة أو المكررة لسه موجودة للمراجعة.`,
      );
      refresh();
    } finally {
      lock.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  const matched = drafts.filter(
    (d) => d.order && d.tracking && d.state === "pending",
  );
  return (
    <>
      <div className="page-heading split">
        <div>
          <div className="eyebrow">من البوليصة للطلب</div>
          <h1>بوالص الشحن</h1>
          <p>
            ارفع PDF أو صوّر بالكاميرا. المطابقة الأساسية برقم موبايل العميل.
          </p>
        </div>
        <span className="badge confirmed">قراءة على جهازك</span>
      </div>
      <section className="panel padded">
        <div className="upload-area">
          <span className="upload-icon">
            <Files size={30} />
          </span>
          <h2>كل بوالصك، دفعة واحدة</h2>
          <p>PDF متعدد الصفحات أو صور · كل صفحة بتتحفظ تحت الطلب المطابق</p>
          <div className="button-row">
            <label className="upload-button primary">
              <Upload size={18} /> رفع ملفات
              <input
                type="file"
                multiple
                accept="application/pdf,image/*"
                disabled={busy}
                onChange={(e) => {
                  void upload(Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
            </label>
            <label className="upload-button">
              <Camera size={18} /> فتح الكاميرا
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => {
                  void upload(Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        {progress && (
          <p className="progress" role="status">
            {progress}
          </p>
        )}
      </section>
      {!!drafts.length && (
        <section className="panel padded section-gap">
          <div className="section-title">
            <h2>
              نتيجة القراءة <span className="count">{drafts.length}</span>
            </h2>
            <button
              className="primary"
              disabled={busy || !matched.length}
              onClick={() => void batch(matched)}
            >
              <CheckCheck size={18} /> قبول كل المطابق ({matched.length})
            </button>
          </div>
          <p className="hint">
            لو الرقم مربوط بأكثر من طلب، أو مش واضح، البوليصة تفضل للمراجعة.
            المكرر يظهر بخيار تحديث أو تجاهل.
          </p>
          {drafts.map((d) => (
            <article
              className={"bill-card " + (d.state === "saved" ? "saved" : "")}
              key={d.id}
            >
              <div className="section-title">
                <strong>{d.name}</strong>
                <span
                  className={
                    "badge " + (d.state === "saved" ? "confirmed" : "new")
                  }
                >
                  {d.state === "saved"
                    ? "اتحفظت"
                    : d.state === "duplicate"
                      ? "مكررة"
                      : d.order
                        ? "مطابقة"
                        : "تحتاج مراجعة"}
                </span>
              </div>
              <BillThumbnail blob={d.blob} />
              <small className="muted">{d.method}</small>
              <div className="form-grid">
                <label>
                  رقم موبايل العميل
                  <input
                    value={d.selectedPhone}
                    dir="ltr"
                    inputMode="tel"
                    disabled={busy || d.state === "saved"}
                    onChange={(e) =>
                      update(d.id, {
                        selectedPhone: e.target.value,
                        order: null,
                        matches: 0,
                        state: "pending",
                      })
                    }
                    onBlur={async () => {
                      const requested = d.selectedPhone;
                      const result = await match(requested);
                      setDrafts((ds) =>
                        ds.map((x) =>
                          x.id === d.id &&
                          phone(x.selectedPhone) === phone(requested)
                            ? { ...x, ...result }
                            : x,
                        ),
                      );
                    }}
                  />
                </label>
                <label>
                  رقم الشحنة
                  <input
                    value={d.tracking || ""}
                    dir="ltr"
                    disabled={busy || d.state === "saved"}
                    onChange={(e) =>
                      update(d.id, {
                        tracking: e.target.value.toUpperCase(),
                        state: "pending",
                      })
                    }
                  />
                </label>
              </div>
              {d.phones.length > 1 && (
                <p className="hint">
                  الأرقام المقروءة: {d.phones.join(" / ")} — اختار رقم المستلم.
                </p>
              )}
              <p>
                {d.order
                  ? `${d.order.name} · ${d.order.code}`
                  : d.matches > 1
                    ? "أكثر من طلب بنفس الرقم — محتاج مراجعة يدوية"
                    : "لم نجد طلبًا واحدًا مطابقًا لهذا الرقم"}
              </p>
              {d.error && <p className="error">{d.error}</p>}
              {d.state !== "saved" && (
                <div className="button-row">
                  <button
                    disabled={busy || !d.order || !tracking(d.tracking || "")}
                    className="primary"
                    onClick={() =>
                      void batch(
                        [d],
                        d.state === "duplicate" ? "update" : "reject",
                      )
                    }
                  >
                    {d.state === "duplicate"
                      ? "تحديث الملف الموجود"
                      : "قبول وربط البوليصة"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      setDrafts((ds) => ds.filter((x) => x.id !== d.id))
                    }
                  >
                    {d.state === "duplicate"
                      ? "تجاهل المكرر"
                      : "إزالة من المراجعة"}
                  </button>
                </div>
              )}
              <details>
                <summary>النص المقروء</summary>
                <pre>{d.text}</pre>
              </details>
            </article>
          ))}
        </section>
      )}
      <Archive
        revision={revision + drafts.filter((d) => d.state === "saved").length}
        notify={notify}
      />
    </>
  );
}
