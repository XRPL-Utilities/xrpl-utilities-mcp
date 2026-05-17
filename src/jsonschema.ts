/**
 * Minimal JSON Schema typing. The MCP SDK accepts plain objects as
 * tool input schemas; we only need a small subset of Draft 7 to
 * describe the args we care about (string / number / object / etc.).
 */

export interface JSONSchema7 {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  description?: string;
  properties?: Record<string, JSONSchema7>;
  required?: string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: JSONSchema7;
  additionalProperties?: boolean | JSONSchema7;
  default?: unknown;
  examples?: unknown[];
  minItems?: number;
  maxItems?: number;
}
