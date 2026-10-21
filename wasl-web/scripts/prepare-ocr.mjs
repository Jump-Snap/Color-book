import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const tesseract = path.dirname(require.resolve("tesseract.js/package.json"));
const core = path.dirname(
  createRequire(path.join(tesseract, "package.json")).resolve(
    "tesseract.js-core/package.json",
  ),
);
const out = new URL("../public/ocr/", import.meta.url);
await fs.mkdir(new URL("lang/", out), { recursive: true });

// Copy only runtime files; the package folder can be within pnpm's node_modules.
await fs.mkdir(new URL("core/", out), { recursive: true });
for (const name of await fs.readdir(core))
  if (/\.(wasm|js)$/.test(name))
    await fs.copyFile(path.join(core, name), new URL("core/" + name, out));
await fs.copyFile(
  path.join(tesseract, "dist/worker.min.js"),
  new URL("worker.min.js", out),
);
const manifest = [];
for (const lang of ["ara", "eng"]) {
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${lang}.traineddata`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("OCR language download failed: " + lang);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(
    new URL("lang/" + lang + ".traineddata.gz", out),
    gzipSync(bytes),
  );
  manifest.push({
    lang,
    url,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await fs.writeFile(
  new URL("sources.json", out),
  JSON.stringify(manifest, null, 2),
);
console.log(
  "Prepared local OCR worker, WASM and Arabic/English language data.",
);
