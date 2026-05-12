/**
 * Master service registry. Adding a new XR-* service is a single line:
 * import the new module + push it onto SERVICES.
 *
 * Tool names are globally namespaced (xrpl_<service>_<verb>) so cross-
 * service calls in one MCP session don't collide with each other or
 * with any other MCP server the user may have connected.
 */

import type { ServiceDef } from "../types.js";
import { sentinel } from "./sentinel.js";
import { pulse } from "./pulse.js";
import { telemetry } from "./telemetry.js";
import { trust } from "./trust.js";
import { vault } from "./vault.js";
import { flows } from "./flows.js";

export const SERVICES: ServiceDef[] = [sentinel, pulse, telemetry, trust, vault, flows];

/** Flat list of every tool across every registered service. */
export const ALL_TOOLS = SERVICES.flatMap((s) =>
  s.tools.map((t) => ({ ...t, _serviceId: s.id, _baseUrl: s.baseUrl })),
);

/** Look up the owning service for a given tool name. */
export function findToolOwner(toolName: string):
  | { service: ServiceDef; tool: ServiceDef["tools"][number] }
  | null {
  for (const service of SERVICES) {
    const tool = service.tools.find((t) => t.name === toolName);
    if (tool) return { service, tool };
  }
  return null;
}
