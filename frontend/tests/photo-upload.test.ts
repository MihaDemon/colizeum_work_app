import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPhoto, attachPhotos, photoBlob } from "../src/lib/photo-upload";

const dataUrl = (bytes: Uint8Array, type = "image/png") =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

afterEach(() => vi.unstubAllGlobals());

describe("photo upload preparation", () => {
  it("preserves two 2 MB files without fetching data URLs", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("Load failed")));
    vi.stubGlobal("fetch", fetch);
    const bytes = Uint8Array.from(
      { length: 2 * 1024 * 1024 },
      (_, index) => index % 256,
    );
    const body = new FormData();
    attachPhotos(
      body,
      ["desk", "receipt"].map((slot) => ({
        slot,
        label: slot,
        url: dataUrl(bytes),
      })),
    );
    const images = body.getAll("photos") as File[];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.size).toBe(bytes.length);
      expect(image.type).toBe("image/png");
      expect(
        Buffer.from(await image.arrayBuffer()).equals(Buffer.from(bytes)),
      ).toBe(true);
    }
    expect(body.get("photo_slots")).toBe('["desk","receipt"]');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 49151, 49152, 49153])(
    "preserves base64 padding and chunk boundaries for %i bytes",
    async (length) => {
      const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
      const blob = photoBlob(dataUrl(bytes));
      expect(blob.size).toBe(length);
      expect(
        Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(bytes)),
      ).toBe(true);
    },
  );

  it.each([
    "data:image/png;base64,broken!",
    "data:image/png;base64,",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "https://example.com/photo.png",
  ])("identifies the unreadable photo for %s", (value) => {
    expect(() => photoBlob(value, "Стол администратора")).toThrow(
      "Не удалось подготовить фото «Стол администратора»",
    );
  });

  it("allows the 5 MB per-file boundary and rejects larger files", () => {
    expect(photoBlob(dataUrl(new Uint8Array(5 * 1024 * 1024))).size).toBe(
      5 * 1024 * 1024,
    );
    expect(() =>
      photoBlob(dataUrl(new Uint8Array(5 * 1024 * 1024 + 1)), "Чек"),
    ).toThrow("превышает 5 МБ");
  });

  it("checks combined bytes before adding files to the request", () => {
    const url = dataUrl(new Uint8Array(4 * 1024 * 1024));
    const body = new FormData();
    expect(() =>
      attachPhotos(
        body,
        Array.from({ length: 4 }, (_, index) => ({
          slot: String(index),
          label: "Фото",
          url,
        })),
      ),
    ).toThrow("превышает 15 МБ");
    expect(body.getAll("photos")).toHaveLength(0);
  });

  it("retains previous evidence without downloading it or charging its bytes to new uploads", () => {
    const body = new FormData();
    attachPhotos(
      body,
      [
        { id: "12", slot: "desk", label: "Стол", url: "/api/files/report/12/" },
        { slot: "receipt", label: "Чек", url: dataUrl(new Uint8Array([1, 2])) },
      ],
      true,
    );
    expect(body.getAll("photos")).toHaveLength(1);
    expect(body.get("photo_slots")).toBe('["receipt"]');
    expect(body.get("retained_photos")).toBe('["12"]');
  });

  it("requires a valid source for every new attachment", () => {
    expect(() =>
      attachPhotos(new FormData(), [{ slot: "desk", label: "Стол", url: "" }]),
    ).toThrow("«Стол»");
  });

  it("preserves image formats and uses the JPEG filename extension", () => {
    for (const [type, extension] of [
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
    ]) {
      const body = new FormData();
      attachPhoto(body, "photo", dataUrl(new Uint8Array([1, 2]), type));
      const file = body.get("photo") as File;
      expect(file.name).toBe(`photo.${extension}`);
      expect(file.type).toBe(type);
    }
  });
});
