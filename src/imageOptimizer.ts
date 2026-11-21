/**
 * Server-side Image Optimization Utility using Sharp
 * Resizes large dimensions (max 1920px), compresses to progressive JPEG (quality 82, mozjpeg),
 * strips unnecessary EXIF metadata, and reduces file size by 70-95% for fast downloads and S3 uploads.
 */

import sharp from "sharp";

export interface OptimizeImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "jpeg" | "webp" | "png";
}

export interface OptimizedImageResult {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  originalSize: number;
  optimizedSize: number;
  width?: number;
  height?: number;
}

/**
 * Optimizes an image buffer using Sharp.
 */
export async function optimizeImageBuffer(
  inputBuffer: Buffer,
  options: OptimizeImageOptions = {}
): Promise<OptimizedImageResult> {
  const {
    maxWidth = 1920,
    maxHeight = 1920,
    quality = 82,
    format = "jpeg",
  } = options;

  const originalSize = inputBuffer.length;

  try {
    const meta = await sharp(inputBuffer).metadata();

    // Preserve animated GIF without recompression that could break animation frames
    if (meta.format === "gif") {
      return {
        buffer: inputBuffer,
        mimeType: "image/gif",
        ext: "gif",
        originalSize,
        optimizedSize: originalSize,
        width: meta.width,
        height: meta.height,
      };
    }

    let pipeline = sharp(inputBuffer)
      .rotate() // auto-orient by EXIF
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });

    let mimeType = "image/jpeg";
    let ext = "jpg";

    if (format === "webp") {
      pipeline = pipeline.webp({ quality, effort: 4 });
      mimeType = "image/webp";
      ext = "webp";
    } else if (format === "png") {
      pipeline = pipeline.png({ compressionLevel: 8, quality });
      mimeType = "image/png";
      ext = "png";
    } else {
      pipeline = pipeline.jpeg({
        quality,
        progressive: true,
        mozjpeg: true,
      });
      mimeType = "image/jpeg";
      ext = "jpg";
    }

    const outputBuffer = await pipeline.toBuffer();
    const optimizedMeta = await sharp(outputBuffer).metadata().catch(() => undefined);

    return {
      buffer: outputBuffer,
      mimeType,
      ext,
      originalSize,
      optimizedSize: outputBuffer.length,
      width: optimizedMeta?.width,
      height: optimizedMeta?.height,
    };
  } catch (err: any) {
    console.warn(`⚠️ [ImageOptimizer] Sharp optimization failed (${err.message}). Using raw buffer.`);
    return {
      buffer: inputBuffer,
      mimeType: "image/jpeg",
      ext: "jpg",
      originalSize,
      optimizedSize: originalSize,
    };
  }
}
