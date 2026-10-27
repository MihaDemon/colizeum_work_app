import { describe, expect, it } from "vitest";
import { availableDevices, deviceLabel } from "../src/lib/devices";
import type { Device } from "../src/lib/types";

const devices: Device[] = [
  {
    id: 1,
    model: "G Pro",
    serial_number: "SN-001",
    info: null,
    detail_url: "",
    qr_code_url: "",
  },
  {
    id: 2,
    model: "G Pro",
    serial_number: "SN-002",
    info: null,
    detail_url: "",
    qr_code_url: "",
  },
  {
    id: 3,
    model: "G Pro",
    serial_number: "SN-003",
    info: null,
    detail_url: "",
    qr_code_url: "",
  },
];
const stations: Device[] = [
  { id: 10, mouse: 1, info: null, detail_url: "", qr_code_url: "" },
  { id: 20, mouse: 2, info: null, detail_url: "", qr_code_url: "" },
];

describe("station assignments with repeated device models", () => {
  it("distinguishes devices of the same model by serial number", () => {
    expect(deviceLabel(devices[0])).toBe("G Pro · SN-001");
    expect(deviceLabel(devices[1])).toBe("G Pro · SN-002");
  });
  it("offers unassigned devices when adding a station", () => {
    expect(
      availableDevices(devices, stations, "mouse").map((device) => device.id),
    ).toEqual([3]);
  });
  it("keeps the current station device available during edits", () => {
    expect(
      availableDevices(devices, stations, "mouse", 10).map(
        (device) => device.id,
      ),
    ).toEqual([1, 3]);
  });
});
