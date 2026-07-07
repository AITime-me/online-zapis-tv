/**
 * Конвертирует логотипы в PNG с настоящей alpha-прозрачностью.
 * Удаляет белый и клетчатый (checkerboard) фон через flood-fill от краёв.
 *
 * Usage: npx tsx scripts/fix-logo-png.ts
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.join(process.cwd(), "public", "logo");
const ASSETS_DIR =
  "C:/Users/Admin/.cursor/projects/c-Users-Admin-Documents-GitHub-online-zapis-tv/assets";

function isBackgroundColor(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;

  if (max >= 248 && spread <= 10) {
    return true;
  }

  if (max >= 228 && spread <= 14) {
    return true;
  }

  if (spread <= 12 && max >= 165 && max <= 252) {
    return true;
  }

  return false;
}

function removeBackgroundFloodFill(
  pixels: Uint8Array,
  width: number,
  height: number,
): number {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let removed = 0;

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    const index = y * width + x;
    if (visited[index]) {
      return;
    }
    const offset = index * 4;
    const r = pixels[offset]!;
    const g = pixels[offset + 1]!;
    const b = pixels[offset + 2]!;
    if (!isBackgroundColor(r, g, b)) {
      return;
    }
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;

    pixels[offset + 3] = 0;
    removed += 1;

    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
  }

  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    const r = pixels[offset]!;
    const g = pixels[offset + 1]!;
    const b = pixels[offset + 2]!;
    const a = pixels[offset + 3]!;

    if (a > 0 && isBackgroundColor(r, g, b)) {
      pixels[offset + 3] = 0;
      removed += 1;
    }
  }

  return removed;
}

async function processLogo(inputPath: string, outputPath: string) {
  const inputBuffer = fs.readFileSync(inputPath);
  const image = sharp(inputBuffer);
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const removed = removeBackgroundFloodFill(pixels, info.width, info.height);

  await sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  const { data: verify } = await sharp(outputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let opaqueBackground = 0;
  let opaque = 0;
  for (let index = 0; index < verify.length; index += 4) {
    const a = verify[index + 3]!;
    if (a < 20) {
      continue;
    }
    opaque += 1;
    if (isBackgroundColor(verify[index]!, verify[index + 1]!, verify[index + 2]!)) {
      opaqueBackground += 1;
    }
  }

  console.log(
    `✓ ${path.basename(outputPath)} (${info.width}x${info.height}) removed=${removed} opaqueBg=${opaqueBackground}/${opaque}`,
  );
}

function resolveSourceFiles(): { green: string; gold: string } {
  if (fs.existsSync(ASSETS_DIR)) {
    const files = fs.readdirSync(ASSETS_DIR);
    const green = files.find((name) => name.includes("__1_-"));
    const gold = files.find((name) => name.includes("__2_-"));
    if (green && gold) {
      return {
        green: path.join(ASSETS_DIR, green),
        gold: path.join(ASSETS_DIR, gold),
      };
    }
  }

  return {
    green: path.join(OUT_DIR, "logo-green.png"),
    gold: path.join(OUT_DIR, "logo-gold.png"),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sources = resolveSourceFiles();
  const greenTemp = path.join(OUT_DIR, "logo-green.tmp.png");
  const goldTemp = path.join(OUT_DIR, "logo-gold.tmp.png");

  await processLogo(sources.green, greenTemp);
  await processLogo(sources.gold, goldTemp);

  fs.renameSync(greenTemp, path.join(OUT_DIR, "logo-green.png"));
  fs.renameSync(goldTemp, path.join(OUT_DIR, "logo-gold.png"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
