// scripts/optimize-webp.mjs
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, "images"); // 处理 images/ 下所有 webp
const MAX_WIDTH = parseInt(process.env.MAX_WIDTH || "1920", 10);
const QUALITY = parseInt(process.env.WEBP_QUALITY || "80", 10);

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function optimizeWebp(filePath) {
  if (!filePath.toLowerCase().endsWith(".webp")) return { changed: false };

  const buf = await fs.readFile(filePath);
  const img = sharp(buf, { failOnError: false });

  let meta;
  try {
    meta = await img.metadata();
  } catch {
    return { changed: false, reason: "metadata_failed" };
  }

  const width = meta?.width ?? 0;

  // 统一：不放大，只在需要时缩小；同时重新编码压缩
  const pipeline = sharp(buf, { failOnError: false })
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY });

  const outBuf = await pipeline.toBuffer();

  // 如果输出没有变小且尺寸也没变（比如已经优化过），就不写回，避免重复重压缩
  const resized = width > MAX_WIDTH;
  const smaller = outBuf.length < buf.length;

  if (!resized && !smaller) return { changed: false, reason: "already_optimized" };

  // 原子写入：先写临时文件再替换
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, outBuf);
  await fs.rename(tmp, filePath);

  return { changed: true, resized, oldBytes: buf.length, newBytes: outBuf.length, width };
}

async function main() {
  if (!(await exists(TARGET_DIR))) {
    console.log(`No images/ directory found at: ${TARGET_DIR}`);
    return;
  }

  const files = await walk(TARGET_DIR);
  const webps = files.filter(f => f.toLowerCase().endsWith(".webp"));

  let changedCount = 0;
  let savedBytes = 0;

  for (const f of webps) {
    const r = await optimizeWebp(f);
    if (r.changed) {
      changedCount++;
      savedBytes += (r.oldBytes - r.newBytes);
      console.log(`✅ optimized: ${path.relative(ROOT, f)} (${r.oldBytes} -> ${r.newBytes} bytes)`);
    }
  }

  console.log(`Done. changed=${changedCount}, saved=${savedBytes} bytes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
