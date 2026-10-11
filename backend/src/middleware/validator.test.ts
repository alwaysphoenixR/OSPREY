import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  assertValidJsonSchema,
  validateToolPayload,
  clearValidatorCache,
} from "./validator.js";

describe("assertValidJsonSchema", () => {
  it("accepts a valid JSON Schema", () => {
    assert.doesNotThrow(() => {
      assertValidJsonSchema({
        type: "object",
        properties: {
          booking_id: { type: "string" },
        },
        required: ["booking_id"],
      });
    });
  });

  it("rejects null schemas", () => {
    assert.throws(() => assertValidJsonSchema(null), /non-null JSON object/);
  });

  it("rejects array schemas", () => {
    assert.throws(() => assertValidJsonSchema([]), /non-null JSON object/);
  });

  it("rejects schemas AJV cannot compile", () => {
    assert.throws(
      () => assertValidJsonSchema({ type: "not-a-valid-json-type" }),
      /Invalid or unsupported JSON Schema/,
    );
  });
});

describe("validateToolPayload", () => {
  beforeEach(() => {
    clearValidatorCache();
  });

  const bookingSchema = {
    type: "object",
    properties: {
      destination: { type: "string" },
      passenger_name: { type: "string" },
    },
    required: ["destination", "passenger_name"],
    additionalProperties: false,
  };

  it("accepts a valid payload", () => {
    const result = validateToolPayload("book-v1", bookingSchema, {
      destination: "Delhi",
      passenger_name: "Alex",
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects a missing required field", () => {
    const result = validateToolPayload("book-v1", bookingSchema, {
      destination: "Delhi",
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects incorrect field types", () => {
    const result = validateToolPayload("book-v1", bookingSchema, {
      destination: 123,
      passenger_name: "Alex",
    });

    assert.equal(result.valid, false);

    assert.ok(
      result.errors.length > 0,
      "Expected at least one validation error",
    );

    assert.ok(
      result.errors.some((error) => error.includes("must be string")),
      `Expected a string type error, got: ${result.errors.join(", ")}`,
    );
  });

  it("reports multiple validation errors", () => {
    const result = validateToolPayload("book-v1", bookingSchema, {
      destination: 123,
      extra: true,
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });

  it("rejects additional properties when the schema forbids them", () => {
    const result = validateToolPayload("book-v1", bookingSchema, {
      destination: "Delhi",
      passenger_name: "Alex",
      unexpected: true,
    });

    assert.equal(result.valid, false);
  });

  it("rejects null schemas", () => {
    const result = validateToolPayload("bad-v1", null, {});

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects array schemas", () => {
    const result = validateToolPayload("bad-v1", [], {});

    assert.equal(result.valid, false);
  });

  it("rejects a schema that cannot compile", () => {
    const result = validateToolPayload(
      "invalid-schema-v1",
      { type: "not-a-valid-json-type" },
      {},
    );

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("compile")));
  });

  it("uses independent schemas for different version IDs", () => {
    const v1 = {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    };

    const v2 = {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
    };

    assert.equal(
      validateToolPayload("tool-v1", v1, { value: "hello" }).valid,
      true,
    );

    assert.equal(
      validateToolPayload("tool-v2", v2, { value: "hello" }).valid,
      false,
    );

    assert.equal(validateToolPayload("tool-v2", v2, { value: 42 }).valid, true);
  });

  it("rejects a different schema supplied for the same version ID", () => {
    const firstSchema = {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    };

    const changedSchema = {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
    };

    assert.equal(
      validateToolPayload("immutable-v1", firstSchema, {
        value: "hello",
      }).valid,
      true,
    );

    const result = validateToolPayload("immutable-v1", changedSchema, {
      value: 42,
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("Schema mismatch")));
  });

  it("recompiles after the cache is cleared", () => {
    const firstSchema = {
      type: "object",
      properties: { value: { type: "string" } },
    };

    const changedSchema = {
      type: "object",
      properties: { value: { type: "number" } },
    };

    validateToolPayload("cache-test-v1", firstSchema, { value: "hello" });

    // While cached, a changed schema is rejected.
    assert.equal(
      validateToolPayload("cache-test-v1", changedSchema, {
        value: 42,
      }).valid,
      false,
    );

    clearValidatorCache();

    // After clearing, the new schema can be compiled for that ID.
    assert.equal(
      validateToolPayload("cache-test-v1", changedSchema, {
        value: 42,
      }).valid,
      true,
    );
  });

  it("rejects an empty version ID", () => {
    const result = validateToolPayload("", bookingSchema, {});

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("toolVersionId")));
  });
});
