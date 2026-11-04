import type { EvidencePhoto } from "./workspace";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_NEW_PHOTO_BYTES = 15 * 1024 * 1024;
// A multiple of four keeps every base64 chunk independently decodable.
const BASE64_CHUNK_SIZE = 64 * 1024;

/** Decode FileReader output locally, including in WebViews that cannot fetch data URLs. */
export function photoBlob(value: string, label = "Фотография"): Blob {
  const comma = value.indexOf(",");
  const header = value.slice(0, comma);
  const match = /^data:(image\/(?:jpeg|png|webp));base64$/i.exec(header);
  const invalid = () =>
    new Error(
      `Не удалось подготовить фото «${label}» к отправке. Выберите его повторно.`,
    );
  if (!match || comma < 0) throw invalid();
  const encoded = value.slice(comma + 1);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw invalid();
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const size = (encoded.length / 4) * 3 - padding;
  if (size > MAX_PHOTO_BYTES)
    throw new Error(
      `Фото «${label}» превышает 5 МБ. Выберите изображение меньшего размера.`,
    );
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    for (let offset = 0; offset < encoded.length; offset += BASE64_CHUNK_SIZE) {
      const decoded = atob(encoded.slice(offset, offset + BASE64_CHUNK_SIZE));
      const bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index++)
        bytes[index] = decoded.charCodeAt(index);
      chunks.push(bytes);
    }
    return new Blob(chunks, { type: match[1].toLowerCase() });
  } catch {
    throw invalid();
  }
}

function appendBlob(body: FormData, field: string, blob: Blob) {
  const extension =
    blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
  body.append(field, blob, `${field}.${extension}`);
}

export function attachPhoto(
  body: FormData,
  field: string,
  value?: string,
  label = "Фотография",
) {
  if (!value?.startsWith("data:")) return;
  appendBlob(body, field, photoBlob(value, label));
}

export function attachPhotos(
  body: FormData,
  photos: EvidencePhoto[],
  retain = false,
) {
  if (photos.length > 10)
    throw new Error("Можно прикрепить не более 10 фотографий.");
  const prepared: { blob: Blob; slot: string }[] = [];
  const retained: string[] = [];
  let total = 0;
  for (const photo of photos) {
    if (photo.url.startsWith("data:")) {
      const blob = photoBlob(photo.url, photo.label);
      total += blob.size;
      if (total > MAX_NEW_PHOTO_BYTES)
        throw new Error(
          "Общий размер новых фотографий превышает 15 МБ. Выберите изображения меньшего размера.",
        );
      prepared.push({ blob, slot: photo.slot });
    } else if (retain && photo.id) retained.push(photo.id);
    else
      throw new Error(
        `Не удалось подготовить фото «${photo.label}» к отправке. Выберите его повторно.`,
      );
  }
  for (const photo of prepared) appendBlob(body, "photos", photo.blob);
  body.append(
    "photo_slots",
    JSON.stringify(prepared.map((photo) => photo.slot)),
  );
  if (retain) body.append("retained_photos", JSON.stringify(retained));
}
