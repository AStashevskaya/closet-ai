// pnpm --filter @closet-ai/server bench:worker <folder of PNG photos>
// Measures the worker's own CPU and memory on the photo pipeline's local parts:
// processPhoto (sharp), the model copy, flattening and the embedding model (ONNX).
// Network parts (Claude, fal) cost wall time but little CPU or memory here.
import { readdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { createFashionSiglipEmbedder } from "../ai/item-embedder";
import { flattenOnWhite, modelCopy, processPhoto } from "../modules/photos/process-photo";

const dir = process.argv[2]!;
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".png"))
  .slice(0, 12);
const mb = (n: number) => Math.round(n / 1024 / 1024);
let peak = 0;
setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20).unref();

// Phone-sized uploads: 2366 × 1774 JPEG at 90%, like shrinkPhoto sends.
const uploads = await Promise.all(
  files.map((f) =>
    sharp(readFileSync(`${dir}/${f}`))
      .flatten({ background: "#ffffff" })
      .resize(2366, 1774, { fit: "cover" })
      .jpeg({ quality: 90 })
      .toBuffer(),
  ),
);
console.log(`start rss ${mb(process.memoryUsage().rss)} MB, ${uploads.length} photos`);
const embedder = createFashionSiglipEmbedder(process.env.MODEL_CACHE_DIR ?? ".models");

async function job(input: Uint8Array) {
  const t0 = performance.now();
  const stored = await processPhoto(input);
  const t1 = performance.now();
  await modelCopy(stored);
  const flat = await flattenOnWhite(stored);
  const t2 = performance.now();
  await embedder.embedImage(flat);
  const t3 = performance.now();
  return { process: t1 - t0, copies: t2 - t1, embed: t3 - t2 };
}

// Warm-up: loads the model.
let c = process.cpuUsage();
let t = performance.now();
await job(uploads[0]!);
console.log(
  `model load + first job: ${Math.round(performance.now() - t)} ms, rss ${mb(process.memoryUsage().rss)} MB, peak ${mb(peak)} MB`,
);

for (const parallel of [1, 4]) {
  peak = process.memoryUsage().rss;
  c = process.cpuUsage();
  t = performance.now();
  const times: { process: number; copies: number; embed: number }[] = [];
  let next = 0;
  const run = async () => {
    while (next < uploads.length * 2) times.push(await job(uploads[next++ % uploads.length]!));
  };
  await Promise.all(Array.from({ length: parallel }, run));
  const wall = performance.now() - t;
  const cpu = process.cpuUsage(c);
  const avg = (k: "process" | "copies" | "embed") =>
    Math.round(times.reduce((s, x) => s + x[k], 0) / times.length);
  console.log(
    `concurrency ${parallel}: ${times.length} jobs in ${Math.round(wall)} ms (${Math.round(wall / times.length)} ms/job), ` +
      `cpu ${Math.round((cpu.user + cpu.system) / 1000 / times.length)} ms/job, cores busy ${((cpu.user + cpu.system) / 1000 / wall).toFixed(2)}, ` +
      `avg process ${avg("process")} / copies ${avg("copies")} / embed ${avg("embed")} ms, peak rss ${mb(peak)} MB`,
  );
}
process.exit(0);
