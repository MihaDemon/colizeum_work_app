import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadDeviceQr } from "../src/lib/download";
import { setToken } from "../src/lib/api";

const file = { url: "https://work.example.com/api/device-qr/signed-ticket/", file_name: "station-1-qr.png" };
afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

function setup(modern = true) {
  const app = { initData: "signed-data", isVersionAtLeast: () => modern, downloadFile: vi.fn(), openLink: vi.fn() };
  vi.stubGlobal("window", { Telegram: { WebApp: app } });
  const fetch = vi.fn().mockImplementation(async () => Response.json(file));
  vi.stubGlobal("fetch", fetch);
  return { app, fetch };
}

describe("QR downloads", () => {
  it("uses an authenticated request for a fresh link and Telegram's native downloader", async () => {
    const { app, fetch } = setup();
    setToken("private-api-token");
    await downloadDeviceQr("stations", 1);
    expect(fetch.mock.calls[0][0].pathname).toBe("/api/stations/1/qr-download/");
    expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Token private-api-token");
    expect(app.downloadFile).toHaveBeenCalledWith(file);
    expect(app.openLink).not.toHaveBeenCalled();
    expect(JSON.stringify(app.downloadFile.mock.calls)).not.toContain("private-api-token");
  });

  it("opens a real attachment URL in the external browser on older Telegram clients", async () => {
    const { app } = setup(false);
    await downloadDeviceQr("stations", 1);
    expect(app.downloadFile).not.toHaveBeenCalled();
    expect(app.openLink).toHaveBeenCalledWith(file.url);
  });

  it("falls back to the external browser if a client cannot open the native dialog", async () => {
    const { app } = setup();
    app.downloadFile.mockImplementation(() => { throw new Error("Unsupported"); });
    await downloadDeviceQr("stations", 1);
    expect(app.openLink).toHaveBeenCalledWith(file.url);
  });

  it("requests a new link for each click", async () => {
    const { fetch } = setup();
    await downloadDeviceQr("stations", 1);
    await downloadDeviceQr("stations", 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces backend errors without pretending the file was downloaded", async () => {
    const { app, fetch } = setup();
    fetch.mockReset().mockResolvedValue(Response.json({ detail: "Download unavailable" }, { status: 500 }));
    await expect(downloadDeviceQr("stations", 1)).rejects.toThrow("Download unavailable");
    expect(app.downloadFile).not.toHaveBeenCalled();
    expect(app.openLink).not.toHaveBeenCalled();
  });
});
