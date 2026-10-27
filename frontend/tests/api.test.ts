import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl, ApiError, list, request, setToken } from "../src/lib/api";
import { lookupFromQr } from "../src/pages/Equipment";

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});
describe("API transport", () => {
  it("reports expired authenticated sessions to the app", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ detail: "Expired token" }, { status: 401 }),
        ),
    );
    setToken("expired");
    await expect(request("reports/")).rejects.toMatchObject({ status: 401 });
    expect(dispatchEvent.mock.calls[0][0].type).toBe("session-expired");
  });
  it("authenticates JSON requests with a Django token", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 1 }));
    vi.stubGlobal("fetch", fetch);
    setToken("test-token");
    await request("pcs/", {
      method: "POST",
      body: JSON.stringify({ cpu: "cpu" }),
    });
    const headers = fetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Token test-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });
  it("lets the browser supply the multipart boundary for repeated photos", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 1 }));
    vi.stubGlobal("fetch", fetch);
    const data = new FormData();
    data.append(
      "uploaded_photos",
      new Blob(["photo"], { type: "image/png" }),
      "photo.png",
    );
    await request("reports/", { method: "POST", body: data });
    expect(fetch.mock.calls[0][1].headers.get("Content-Type")).toBeNull();
    expect(fetch.mock.calls[0][1].body).toBe(data);
  });
  it("follows DRF pagination through the configured host", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [{ id: 1 }],
          next: "http://internal:8000/api/pcs/?page=2",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ results: [{ id: 2 }], next: null }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await list("pcs/")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetch.mock.calls[1][0].href).toBe(
      "http://localhost/api/pcs/?page=2",
    );
  });
  it("rejects pagination outside the API", () => {
    expect(() => apiUrl("https://example.org/collect-token")).toThrow();
  });
  it("surfaces registration-required responses without discarding their fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ require_registration: "True" }, { status: 404 }),
        ),
    );
    await expect(request("telegram/telegram/")).rejects.toMatchObject({
      status: 404,
      data: { require_registration: "True" },
    });
  });
  it("preserves server validation messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { uploaded_photos: ["Для отчёта необходима фотография."] },
            { status: 400 },
          ),
        ),
    );
    await expect(request("reports/")).rejects.toBeInstanceOf(ApiError);
  });
});
describe("QR lookup", () => {
  it("preserves punctuation and Unicode serial numbers without trusting the scanned host", () => {
    const serial = "SN/Колизеум ?&+123";
    const result = lookupFromQr(
      `https://another-host.example/api/mice/lookup/?${new URLSearchParams({ serial_number: serial })}`,
    );
    expect(result.resource).toBe("mice");
    expect(
      new URL(result.path, "https://app.example/api/").searchParams.get(
        "serial_number",
      ),
    ).toBe(serial);
  });
  it("recognizes station identifiers", () => {
    expect(
      lookupFromQr("https://club.example/api/stations/lookup/?club_number=12")
        .path,
    ).toBe("stations/lookup/?club_number=12");
  });
  it("rejects unrelated URLs and missing identifiers", () => {
    expect(() => lookupFromQr("https://example.org/")).toThrow();
    expect(() => lookupFromQr("https://example.org/api/pcs/lookup/")).toThrow();
  });
});
