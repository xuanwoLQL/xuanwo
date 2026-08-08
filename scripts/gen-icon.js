// 生成 xuanwo 图标 (ICO)
// 纯 Node 生成一个 32x32 盾牌风格图标（BMP 编码进 ICO）
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist");
const icoPath = join(outDir, "xuanwo.ico");

// 32x32 BGRA 像素，简单盾牌图案
const SIZE = 32;
const px = new Uint8Array(SIZE * SIZE * 4);

// 背景透明
// 盾牌主体 (蓝)
const shield = (x, y) => {
  // 简化盾牌形状
  const cx = x - 15.5;
  const cy = y - 15.5;
  const inShield =
    Math.abs(cy) < 12 &&
    Math.abs(cx) < 10 &&
    // 上宽下尖的盾形
    (y < 8 ? Math.abs(cx) < 7 + (y - 8) * 0.8 : true) &&
    (y > 20 ? Math.abs(cx) < 14 - (y - 20) * 1.2 : true);
  return inShield && y > 2;
};

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    if (shield(x, y)) {
      // 主色 #3B82F6
      px[i] = 0xf6; // B
      px[i + 1] = 0x82; // G
      px[i + 2] = 0x3b; // R
      px[i + 3] = 0xff; // A
    } else {
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = 0;
    }
  }
}

// 构建 BMP (BITMAPINFOHEADER + BGRA)
const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0); // header size
bmpHeader.writeInt32LE(SIZE, 4); // width
bmpHeader.writeInt32LE(SIZE * 2, 8); // height (x2 for AND mask)
bmpHeader.writeUInt16LE(1, 12); // planes
bmpHeader.writeUInt16LE(32, 14); // bpp
bmpHeader.writeUInt32LE(SIZE * SIZE * 4, 20); // image size (no AND mask for 32bpp)

// BMP 行按 4 字节对齐（32bpp 天然对齐）
const bmp = Buffer.concat([bmpHeader, Buffer.from(px.buffer)]);

// ICO: ICONDIR(6) + ICONDIRENTRY(16) + image
const ico = Buffer.alloc(6 + 16 + bmp.length);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // count
ico[6] = SIZE; // width
ico[7] = SIZE; // height
ico[8] = 0; // colors
ico[9] = 0; // reserved
ico.writeUInt16LE(1, 10); // planes
ico.writeUInt16LE(32, 12); // bpp
ico.writeUInt32LE(bmp.length, 14); // size
ico.writeUInt32LE(6 + 16, 18); // offset
bmp.copy(ico, 6 + 16);

writeFileSync(icoPath, ico);
console.log(`图标已生成: ${icoPath} (${ico.length} bytes)`);
