import type { Device } from "./types";

export type StationDeviceField =
  "mouse" | "keyboard" | "headset" | "monitor" | "pc";

export function deviceLabel(device: Device): string {
  const model = device.model || device.cpu || "ПК";
  return device.serial_number ? `${model} · ${device.serial_number}` : model;
}

export function availableDevices(
  devices: Device[],
  stations: Device[],
  field: StationDeviceField,
  currentStationId?: number,
): Device[] {
  const assigned = new Set(
    stations
      .filter((station) => station.id !== currentStationId)
      .map((station) => station[field]),
  );
  return devices.filter((device) => !assigned.has(device.id));
}
