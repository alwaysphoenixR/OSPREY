// src/utils/hash.ts
import * as crypto from "crypto";

/**
 * Creates a deterministic SHA-256 hash of any JSON-serializable object.
 * Recursively sorts object keys before stringifying.
 */
export function canonicalHash(value: unknown): string {
  const sortKeys = (obj: any): any => {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(sortKeys);

    return Object.keys(obj)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = sortKeys(obj[key]);
          return acc;
        },
        {} as Record<string, any>,
      );
  };

  const normalized = JSON.stringify(sortKeys(value));
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
