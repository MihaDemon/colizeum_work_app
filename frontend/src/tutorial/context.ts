import { createContext } from "react";
import type { request } from "../lib/api";

/** Non-null only inside the isolated training workspace. */
export const TrainingPhoto = createContext<string | null>(null);
export const TrainingRequest = createContext<typeof request | null>(null);
