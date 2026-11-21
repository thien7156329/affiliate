/**
 * Client-side Image Compression Utility
 * Resizes large photos to optimal dimensions (max 1600px) and compresses quality
 * to ~82% JPEG before uploading. Reduces 5MB-15MB raw files to 150KB-300KB
 * for lightning-fast uploads without noticeable visual degradation.
 */

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0 to 1, default 0.82
  mimeType?: 'image/jpeg' | 'image/webp' | 'image/png';
}

export interface CompressedResult {
  dataUrl: string;
  blob: Blob;
  size: number;
  originalSize: number;
  width: number;
  height: number;
}

/**
 * Compresses an image File or Blob using HTML5 Canvas.
 */
export async function compressImageFile(
  file: File | Blob,
  options: CompressImageOptions = {}
): Promise<CompressedResult> {
  const {
    maxWidth = 1600,
    maxHeight = 1600,
    quality = 0.82,
    mimeType = 'image/jpeg',
  } = options;

  const originalSize = file.size;

  // If not an image (e.g. invalid type), fallback to reading as data URL
  if (file.type && !file.type.startsWith('image/')) {
    const dataUrl = await fileToDataUrl(file);
    return {
      dataUrl,
      blob: file,
      size: originalSize,
      originalSize,
      width: 0,
      height: 0,
    };
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Calculate aspect-ratio preserving dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          throw new Error('Canvas 2D context not available');
        }

        // Fill white background for JPEG to prevent transparent areas turning black
        if (mimeType === 'image/jpeg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        URL.revokeObjectURL(objectUrl);

        const dataUrl = canvas.toDataURL(mimeType, quality);

        canvas.toBlob(
          (blob) => {
            const finalBlob = blob || file;
            const size = finalBlob.size;

            console.log(
              `🖼️ [ImageCompressor] ${(originalSize / 1024).toFixed(1)} KB ➔ ${(size / 1024).toFixed(1)} KB (-${Math.round((1 - size / Math.max(1, originalSize)) * 100)}%) [${width}x${height}]`
            );

            resolve({
              dataUrl,
              blob: finalBlob,
              size,
              originalSize,
              width,
              height,
            });
          },
          mimeType,
          quality
        );
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image: ' + err));
    };

    img.src = objectUrl;
  });
}

/**
 * Compresses an existing base64 Data URL (e.g. from Clipboard paste).
 */
export async function compressDataUrl(
  dataUrl: string,
  options: CompressImageOptions = {}
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  const {
    maxWidth = 1600,
    maxHeight = 1600,
    quality = 0.82,
    mimeType = 'image/jpeg',
  } = options;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(dataUrl);
        }

        if (mimeType === 'image/jpeg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL(mimeType, quality);
        resolve(compressed);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
