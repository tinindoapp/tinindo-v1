// Foto do perfil (recado #64, item 4): preparada no navegador antes do envio. Recorte quadrado ao centro, 800 × 800,
// WebP com qualidade 0,82 (JPEG quando o navegador não gera WebP), alvo de até 300 KB. Passar pelo canvas descarta os
// metadados da câmera (EXIF, inclusive GPS): o arquivo original nunca sai do aparelho.

/** Maior arquivo aceito na escolha (antes de reduzir). */
export const PHOTO_MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** Limite do bucket profile-photos. */
export const PHOTO_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const PHOTO_SIDE = 800;
export const PHOTO_TARGET_BYTES = 300 * 1024;
/** Qualidade inicial e as reduções até caber no alvo. */
export const PHOTO_QUALITIES = [0.82, 0.72, 0.62, 0.52] as const;

export interface ProcessedPhoto {
  blob: Blob;
  type: "image/webp" | "image/jpeg";
  ext: "webp" | "jpg";
}

export class PhotoError extends Error {}

/** Recorte quadrado centralizado de uma imagem w × h. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height);
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), side };
}

export interface PhotoDeps {
  /** Decodifica o arquivo já com a orientação da câmera aplicada. */
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close?: () => void }>;
  /** Desenha o recorte num quadrado PHOTO_SIDE e codifica; null se o navegador não conseguiu. */
  encode(
    image: { source: CanvasImageSource },
    crop: { sx: number; sy: number; side: number },
    type: ProcessedPhoto["type"],
    quality: number,
  ): Promise<Blob | null>;
}

export const browserPhotoDeps: PhotoDeps = {
  async decode(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  encode(image, crop, type, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIDE;
    canvas.height = PHOTO_SIDE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  },
};

export async function processPhoto(file: File, deps: PhotoDeps = browserPhotoDeps): Promise<ProcessedPhoto> {
  if (!file.type.startsWith("image/")) throw new PhotoError("Escolha uma imagem (JPG, PNG ou WebP).");
  if (file.size > PHOTO_MAX_INPUT_BYTES) throw new PhotoError("A foto passa de 10 MB. Escolha uma menor.");
  let image: Awaited<ReturnType<PhotoDeps["decode"]>>;
  try {
    image = await deps.decode(file);
  } catch {
    throw new PhotoError("Não foi possível abrir esta imagem. Tente outra foto.");
  }
  try {
    const crop = squareCrop(image.width, image.height);
    let type: ProcessedPhoto["type"] = "image/webp";
    let best: Blob | null = null;
    for (const quality of PHOTO_QUALITIES) {
      let blob = await deps.encode(image, crop, type, quality);
      // Navegador sem WebP devolve PNG (ou nada): segue em JPEG, que todos geram.
      if (type === "image/webp" && blob?.type !== "image/webp") {
        type = "image/jpeg";
        blob = await deps.encode(image, crop, type, quality);
      }
      if (!blob) break;
      best = blob;
      if (blob.size <= PHOTO_TARGET_BYTES) break;
    }
    if (!best || best.size > PHOTO_MAX_UPLOAD_BYTES) throw new PhotoError("Não foi possível reduzir esta foto. Tente outra.");
    return { blob: best, type, ext: type === "image/webp" ? "webp" : "jpg" };
  } finally {
    image.close?.();
  }
}
