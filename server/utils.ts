// server/utils.ts
import path from "path";
import { fileURLToPath } from "url";

export function fileURLTo__dirname(importMetaUrl: string): string {
  const __filename = fileURLToPath(importMetaUrl);
  return path.dirname(__filename);
}