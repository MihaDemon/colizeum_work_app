import { createContext } from "react";

/** Non-null only inside the isolated training workspace. */
export const TrainingPhoto = createContext<string | null>(null);
