import {
  IconCpu,
  IconDeviceDesktop,
  IconDeviceGamepad2,
  IconDevicesPc,
  IconHeadphones,
  IconKeyboard,
  IconMouse,
} from "@tabler/icons-react";
import type { Resource } from "../lib/types";

const icons = {
  stations: IconDevicesPc,
  pcs: IconCpu,
  mice: IconMouse,
  keyboards: IconKeyboard,
  headsets: IconHeadphones,
  monitors: IconDeviceDesktop,
  playstations: IconDeviceGamepad2,
} satisfies Record<Resource, typeof IconCpu>;

export function DeviceIcon({
  resource,
  size = 24,
}: {
  resource: Resource;
  size?: number;
}) {
  const Icon = icons[resource];
  return <Icon size={size} stroke={1.8} aria-hidden="true" />;
}
