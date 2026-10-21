import { useEffect, useState } from "react";
import { Trash2, FolderClock } from "lucide-react";
import { db, checked, call, date } from "./api";
export function Storage({
  profile,
  notify,
}: {
  profile: { workspace_id: string; role: string };
  notify: (s: string) => void;
}) {
  const [days, setDays] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [preview, setPreview] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    db.from("settings")
      .select("retention_days")
      .single()
      .then((r) => setDays(r.data?.retention_days?.toString() || ""));
  }, []);
  const admin = profile.role === "admin";
  const range = () => {
    if (!from || !to || from > to)
      throw Error("اختار تاريخ بداية ونهاية صحيحين");
    const end = new Date(to + "T00:00:00");
    end.setDate(end.getDate() + 1);
    return [new Date(from + "T00:00:00").toISOString(), end.toISOString()];
  };
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">مساحة منظمة</div>
        <h1>إدارة الملفات القديمة</h1>
        <p>
          حذف ملفات البوالص يوفّر المساحة. الطلب ورقم الشحنة وسجل الحالات يفضلوا
          محفوظين.
        </p>
      </div>
      <section className="panel padded">
        <h2>
          <FolderClock size={22} /> الحذف التلقائي
        </h2>
        <p className="muted">
          مقفول افتراضيًا. لو فعّلته، الملفات الأقدم من المدة المختارة هتتحذف
          نهائيًا.
        </p>
        <label>
          الاحتفاظ بالملفات لمدة
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">الاحتفاظ بكل الملفات — بدون حذف تلقائي</option>
            {[30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} يوم
              </option>
            ))}
          </select>
        </label>
        {days && (
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            فاهم إن الملفات الأقدم من {days} يوم هتتحذف نهائيًا.
          </label>
        )}
        <button
          className="primary"
          disabled={busy || !admin || (!!days && !confirmed)}
          onClick={() =>
            void run(async () => {
              checked(
                await db
                  .from("settings")
                  .update({ retention_days: days ? Number(days) : null })
                  .eq("workspace_id", profile.workspace_id),
              );
              setConfirmed(false);
              notify(
                days
                  ? "اتفعّل الحذف التلقائي حسب المدة"
                  : "اتوقف الحذف التلقائي",
              );
            })
          }
        >
          حفظ سياسة الاحتفاظ
        </button>
      </section>
      <section className="panel padded section-gap">
        <h2>
          <Trash2 size={21} /> حذف حسب تاريخ رفع الملفات
        </h2>
        <div className="form-grid">
          <label>
            من يوم
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            إلى يوم — شامل
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreview(null);
              }}
            />
          </label>
        </div>
        <button
          disabled={busy || !admin}
          onClick={() =>
            void run(async () => {
              const [a, b] = range();
              const rows = checked(
                await db
                  .from("file_archive")
                  .select("id,file_name,tracking,created_at")
                  .is("deleted_at", null)
                  .gte("created_at", a)
                  .lt("created_at", b)
                  .order("created_at")
                  .limit(501),
              );
              if (rows.length > 500)
                throw Error(
                  "المدة فيها أكثر من 500 ملف. اختار فترة أقصر لعرض كل الملفات قبل الحذف.",
                );
              setPreview(rows);
            })
          }
        >
          معاينة الملفات قبل الحذف
        </button>
        {preview && (
          <div className="deletion-preview">
            <h3>{preview.length} ملف في الفترة المختارة</h3>
            {preview.map((b) => (
              <div className="list-row" key={b.id}>
                <div>
                  <strong>{b.file_name}</strong>
                  <small>
                    {b.tracking} · {date(b.created_at)}
                  </small>
                </div>
              </div>
            ))}
            {!!preview.length && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      `حذف ${preview.length} ملف نهائيًا؟ بيانات الطلبات وأرقام الشحن هتفضل محفوظة.`,
                    )
                  )
                    return;
                  void run(async () => {
                    const [a, b] = range();
                    checked(
                      await db.rpc("queue_deletion", {
                        p_ids: preview.map((x) => x.id),
                        p_from: a,
                        p_to: b,
                      }),
                    );
                    await call("cleanup");
                    setPreview(null);
                    notify(
                      "اتنفذ طلب الحذف؛ أي ملف تعذر حذفه هتتم إعادة المحاولة تلقائيًا.",
                    );
                  });
                }}
              >
                <Trash2 size={16} /> حذف الملفات المعروضة نهائيًا
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
