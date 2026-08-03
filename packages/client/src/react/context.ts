import type { CerebroClient } from "@cerebro/client";
import { createContext } from "react";

/**
 * Only the client goes in the context. It already owns the manifest, the
 * defaults and the strictness it was built with, so nothing has to be kept in
 * sync between the provider and the hooks.
 */
export const CerebroContext = createContext<CerebroClient | null>(null);
