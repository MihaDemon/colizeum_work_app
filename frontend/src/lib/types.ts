export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  last_login: string | null;
  is_active: boolean;
  is_staff: boolean;
  is_superuser?: boolean;
  role?: "admin" | "manager" | "superuser";
}
export interface Device {
  id: number;
  model?: string;
  serial_number?: string;
  club_number?: number;
  warranty_until?: string | null;
  info: string | null;
  detail_url: string;
  qr_code_url: string;
  cpu?: string;
  gpu?: string;
  ram?: string;
  storage?: string;
  mouse?: number | null;
  keyboard?: number | null;
  headset?: number | null;
  monitor?: number | null;
  pc?: number | null;
}
export type Resource =
  | "stations"
  | "mice"
  | "keyboards"
  | "headsets"
  | "monitors"
  | "pcs"
  | "playstations";
