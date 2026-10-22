import { phones, trackings, plain } from "../shared/domain";
let lock: Promise<unknown> = Promise.resolve();
export function imageText(
  file: Blob,
  progress: (s: string) => void,
): Promise<string> {
  const task = lock
    .catch(() => {})
    .then(async () => {
      const { createWorker } = await import("tesseract.js");
      progress("جاري تجهيز قراءة الصورة…");
      const worker = await createWorker("ara+eng", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/core",
        langPath: "/ocr/lang",
        logger: (m) => {
          if (m.status === "recognizing text")
            progress("قراءة الصورة " + Math.round(m.progress * 100) + "٪");
        },
      });
      try {
        const r = await worker.recognize(file);
        return r.data.text;
      } finally {
        await worker.terminate();
      }
    });
  lock = task;
  return task;
}
export type Page = {
  blob: Blob;
  text: string;
  name: string;
  phones: string[];
  tracking: string | null;
  method: string;
};
export function fields(text: string) {
  const n = plain(text);
  const marker = n.search(
    /(?:المرسل\s*اليه|المستلم|بيانات\s*العميل|recipient|receiver)/i,
  );
  let section = text;
  if (marker >= 0) {
    const normalized = text.normalize("NFKC");
    const m = normalized.search(
      /(?:المرسل\s*[إا]ليه|المستلم|بيانات\s*العميل|recipient|receiver)/i,
    );
    if (m >= 0)
      section = normalized
        .slice(m, m + 500)
        .split(/بيانات\s*المرسل|sender/i)[0];
  }
  return {
    phones: phones(section),
    tracking: trackings(text).length === 1 ? trackings(text)[0] : null,
  };
}
export async function readFile(
  file: File,
  progress: (s: string) => void,
): Promise<Page[]> {
  if (file.size > 50 * 1024 * 1024) throw Error("الملف أكبر من 50 ميجابايت");
  if (file.type !== "application/pdf") {
    const text = await imageText(file, progress);
    return [
      {
        blob: file,
        text,
        name: file.name,
        ...fields(text),
        method: "قراءة صورة — راجع البيانات",
      },
    ];
  }
  const pdf = await import("pdfjs-dist");
  const { default: worker } =
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdf.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdf.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: Page[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      progress(`قراءة صفحة ${i} من ${doc.numPages}`);
      const page = await doc.getPage(i),
        content = await page.getTextContent();
      const items = content.items.filter((x): x is any => "str" in x);
      const lines = new Map<number, any[]>();
      for (const item of items) {
        const y = Math.round(item.transform[5] / 3) * 3;
        lines.set(y, [...(lines.get(y) || []), item]);
      }
      let text = [...lines.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, line]) =>
          line
            .sort((a, b) => b.transform[4] - a.transform[4])
            .map((x) => x.str)
            .join(" "),
        )
        .join("\n");
      const canvas = document.createElement("canvas"),
        viewport = page.getViewport({ scale: 2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
      }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(Error("تعذر تحويل الصفحة"))),
          "image/png",
        ),
      );
      let method = "نص PDF";
      let f = fields(text);
      if (!f.phones.length || !f.tracking) {
        text += "\n" + (await imageText(blob, progress));
        f = fields(text);
        method = "نص PDF + قراءة صورة";
      }
      pages.push({
        blob,
        text,
        name: file.name.replace(/\.pdf$/i, "") + "-صفحة-" + i + ".png",
        ...f,
        method,
      });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
export async function hash(blob: Blob) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
// Dark-mode SMS screenshots have separate grey bubbles. Read each bubble separately
// so one shipping code cannot inherit the status of its neighbour.
export async function postalImageText(
  file: Blob,
  progress: (s: string) => void,
) {
  const bitmap = await createImageBitmap(file);
  const source = document.createElement("canvas");
  source.width = bitmap.width;
  source.height = bitmap.height;
  const ctx = source.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, source.width, source.height),
    w = source.width,
    h = source.height;
  const bands: { top: number; bottom: number; left: number; right: number }[] =
    [];
  let start = -1,
    left = w,
    right = 0;
  for (let y = 0; y < h; y++) {
    let grey = 0,
      min = w,
      max = 0;
    for (let x = Math.floor(w * 0.04); x < w * 0.96; x++) {
      const i = (y * w + x) * 4,
        a = data[i],
        b = data[i + 1],
        c = data[i + 2];
      if (a > 35 && a < 145 && Math.max(a, b, c) - Math.min(a, b, c) < 18) {
        grey++;
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
    }
    if (grey > w * 0.22) {
      if (start < 0) {
        start = y;
        left = min;
        right = max;
      } else {
        left = Math.min(left, min);
        right = Math.max(right, max);
      }
    } else if (start >= 0) {
      if (y - start > 22) bands.push({ top: start, bottom: y, left, right });
      start = -1;
    }
  }
  if (start >= 0 && h - start > 22)
    bands.push({ top: start, bottom: h, left, right });
  if (bands.length < 2) {
    source.width = 0;
    source.height = 0;
    return imageText(file, progress);
  }
  const T = await import("tesseract.js");
  const opts = {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
  };
  const arabic = await T.createWorker("ara+eng", 1, opts),
    english = await T.createWorker("eng", 1, opts);
  const blocks: string[] = [];
  try {
    await english.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      tessedit_pageseg_mode: T.PSM.SINGLE_LINE,
    });
    for (let n = 0; n < bands.length; n++) {
      progress(`قراءة رسالة ${n + 1} من ${bands.length}`);
      const b = bands[n],
        width = b.right - b.left + 1,
        height = b.bottom - b.top;
      const canvas = document.createElement("canvas");
      canvas.width = (width + 12) * 3;
      canvas.height = (height + 12) * 3;
      const c = canvas.getContext("2d")!;
      // Padding is inverted with the screenshot; start black so it becomes white.
      c.fillStyle = "black";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.drawImage(
        source,
        b.left,
        b.top,
        width,
        height,
        18,
        18,
        width * 3,
        height * 3,
      );
      const pixels = c.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const v = pixels.data[i] > 165 ? 0 : 255;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v;
      }
      c.putImageData(pixels, 0, 0);
      const result = await arabic.recognize(canvas);
      let text = result.data.text;
      const codes = new Set(trackings(text));
      // Isolate text rows to read the Latin tracking line without Arabic competing.
      let line = -1;
      for (let y = 0; y < canvas.height; y++) {
        let ink = 0;
        for (let x = 0; x < canvas.width; x++)
          if (pixels.data[(y * canvas.width + x) * 4] < 60) ink++;
        if (ink > canvas.width * 0.008) {
          if (line < 0) line = y;
        } else if (line >= 0) {
          if (y - line > 7) {
            const row = document.createElement("canvas");
            row.width = canvas.width;
            row.height = y - line + 16;
            const rc = row.getContext("2d")!;
            rc.fillStyle = "white";
            rc.fillRect(0, 0, row.width, row.height);
            rc.drawImage(
              canvas,
              0,
              line,
              canvas.width,
              y - line,
              0,
              8,
              canvas.width,
              y - line,
            );
            const latin = await english.recognize(row);
            for (const code of trackings(latin.data.text)) codes.add(code);
            row.width = 0;
            row.height = 0;
          }
          line = -1;
        }
      }
      text = text.replace(/عميلنا\s+العزيز/g, "").trim();
      blocks.push("عميلنا العزيز\n" + text + "\n" + [...codes].join(" "));
      canvas.width = 0;
      canvas.height = 0;
    }
    return blocks.join("\n\n");
  } finally {
    await arabic.terminate();
    await english.terminate();
    source.width = 0;
    source.height = 0;
  }
}
