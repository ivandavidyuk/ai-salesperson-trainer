// Сжатие фото профиля перед отправкой.
//
// Делаем на клиенте через canvas, а не на сервере: серверное сжатие
// потребовало бы sharp с нативной сборкой в Docker ради одной операции.
// Заодно по сети уходит 40 КБ вместо нескольких мегабайт.

/** Сторона квадрата, до которого ужимаем фото */
const SIZE = 400;
const QUALITY = 0.85;

/**
 * Вписывает изображение в квадрат SIZE×SIZE с обрезкой по центру
 * и возвращает JPEG. Пропорции сохраняются: лицо не растягивается.
 */
export async function compressAvatar(file: File): Promise<Blob> {
  const bitmap = await loadImage(file);

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas недоступен");

  // Квадратная область по центру исходника — так аватар не искажается
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);

  // Освобождаем декодированный битмап: он может весить десятки мегабайт
  if ("close" in bitmap) bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("не удалось сжать"))),
      "image/jpeg",
      QUALITY
    );
  });
}

// createImageBitmap есть не везде (Safari до 17), поэтому с запасным путём
async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("не удалось прочитать файл"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
