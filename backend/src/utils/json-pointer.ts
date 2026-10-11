import type { CompensationMap } from "../types/compensation.js";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Unescapes a single RFC 6901 reference token.
 * Only ~0 and ~1 are valid escape sequences.
 */
function unescapeToken(token: string): string {
  if (/~(?![01])/.test(token)) {
    throw new Error(`Invalid RFC 6901 escape sequence in token "${token}".`);
  }

  // RFC 6901 requires this replacement order.
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Resolves an RFC 6901 JSON Pointer against a document.
 *
 * ""  -> entire document
 * "/" -> property with an empty name
 *
 * Returns undefined for missing properties or invalid array indexes.
 * Throws for malformed pointers and forbidden property segments.
 */
export function resolveJsonPointer(
  document: unknown,
  pointer: string,
): unknown {
  if (typeof pointer !== "string") {
    throw new Error("JSON Pointer must be a string.");
  }

  if (pointer === "") {
    return document;
  }

  if (!pointer.startsWith("/")) {
    throw new Error(
      `Invalid RFC 6901 JSON Pointer "${pointer}". ` +
        'Non-empty pointers must start with "/".',
    );
  }

  const rawTokens = pointer.slice(1).split("/");
  let current: unknown = document;

  for (const rawToken of rawTokens) {
    const token = unescapeToken(rawToken);

    if (FORBIDDEN_SEGMENTS.has(token)) {
      throw new Error(
        `Security violation: forbidden pointer segment "${token}".`,
      );
    }

    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }

    if (Array.isArray(current)) {
      // RFC 6901 array indexes use decimal notation without leading zeros.
      if (!/^(0|[1-9][0-9]*)$/.test(token)) {
        return undefined;
      }

      const index = Number(token);

      if (!Number.isSafeInteger(index)) {
        return undefined;
      }

      current = current[index];
    } else {
      const record = current as Record<string, unknown>;

      if (!Object.prototype.hasOwnProperty.call(record, token)) {
        return undefined;
      }

      current = record[token];
    }
  }

  return current;
}

/**
 * Validates a compensation map received from runtime or database data.
 *
 * The assertion narrows unknown input to CompensationMap after validation.
 */
export function validateCompensationMap(
  map: unknown,
): asserts map is CompensationMap {
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("compensationMap must be a non-null object.");
  }

  const entries = Object.entries(map);

  if (entries.length === 0) {
    throw new Error("compensationMap cannot be empty.");
  }

  for (const [targetField, rule] of entries) {
    if (targetField.length === 0 || FORBIDDEN_SEGMENTS.has(targetField)) {
      throw new Error(
        `Invalid or forbidden compensation target field "${targetField}".`,
      );
    }

    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(
        `Invalid compensation rule for target field "${targetField}".`,
      );
    }

    const candidate = rule as Record<string, unknown>;

    if (candidate.from !== "request" && candidate.from !== "response") {
      throw new Error(
        `Invalid source for compensation target "${targetField}".`,
      );
    }

    if (typeof candidate.pointer !== "string") {
      throw new Error(
        `Pointer for compensation target "${targetField}" must be a string.`,
      );
    }

    const pointer = candidate.pointer;

    if (pointer !== "" && !pointer.startsWith("/")) {
      throw new Error(
        `Invalid JSON Pointer "${pointer}" for target "${targetField}".`,
      );
    }

    // Validate escape sequences and forbidden segments even before
    // the source document is available.
    if (pointer !== "") {
      for (const rawToken of pointer.slice(1).split("/")) {
        const token = unescapeToken(rawToken);

        if (FORBIDDEN_SEGMENTS.has(token)) {
          throw new Error(
            `Security violation: forbidden pointer segment "${token}".`,
          );
        }
      }
    }
  }
}

/**
 * Builds the payload for a compensating tool.
 *
 * The final payload must still be validated against the compensating
 * tool version's input JSON Schema before execution.
 */
export function buildCompensationPayload(
  compensationMap: unknown,
  requestPayload: unknown,
  responsePayload: unknown,
): Record<string, unknown> {
  validateCompensationMap(compensationMap);

  // Avoid inheriting properties from Object.prototype.
  const result = Object.create(null) as Record<string, unknown>;

  for (const [targetField, rule] of Object.entries(compensationMap)) {
    const sourceDoc =
      rule.from === "request" ? requestPayload : responsePayload;

    if (sourceDoc === null || sourceDoc === undefined) {
      throw new Error(
        `Cannot build compensation payload: "${rule.from}" payload ` +
          `is missing for target field "${targetField}".`,
      );
    }

    const extractedValue = resolveJsonPointer(sourceDoc, rule.pointer);

    if (extractedValue === undefined || extractedValue === null) {
      throw new Error(
        `Compensation mapping failed: pointer "${rule.pointer}" ` +
          `in "${rule.from}" resolved to ${String(extractedValue)} ` +
          `for target field "${targetField}".`,
      );
    }

    result[targetField] = extractedValue;
  }

  return result;
}
