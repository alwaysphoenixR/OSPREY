import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveJsonPointer,
  buildCompensationPayload,
} from "./json-pointer.js";

describe("resolveJsonPointer", () => {
  it("resolves a top-level property", () => {
    assert.equal(
      resolveJsonPointer({ booking_id: "FL_123" }, "/booking_id"),
      "FL_123",
    );
  });

  it("resolves nested properties", () => {
    const document = {
      data: {
        booking: {
          id: "FL_123",
        },
      },
    };

    assert.equal(resolveJsonPointer(document, "/data/booking/id"), "FL_123");
  });

  it("resolves array indexes", () => {
    const document = {
      items: [{ id: "first" }, { id: "second" }],
    };

    assert.equal(resolveJsonPointer(document, "/items/1/id"), "second");
  });

  it("supports the root pointer", () => {
    const document = { booking_id: "FL_123" };

    assert.equal(resolveJsonPointer(document, ""), document);
  });

  it("supports a property with an empty name", () => {
    assert.equal(resolveJsonPointer({ "": "empty-key" }, "/"), "empty-key");
  });

  it("decodes ~1 as a slash", () => {
    assert.equal(resolveJsonPointer({ "a/b": "value" }, "/a~1b"), "value");
  });

  it("decodes ~0 as a tilde", () => {
    assert.equal(resolveJsonPointer({ "m~n": "value" }, "/m~0n"), "value");
  });

  it("decodes ~01 correctly as ~1, not a slash", () => {
    assert.equal(resolveJsonPointer({ "~1": "value" }, "/~01"), "value");
  });

  it("rejects invalid escape sequences", () => {
    assert.throws(
      () => resolveJsonPointer({ "~2": "value" }, "/~2"),
      /Invalid RFC 6901 escape sequence/,
    );

    assert.throws(
      () => resolveJsonPointer({ "name~": "value" }, "/name~"),
      /Invalid RFC 6901 escape sequence/,
    );
  });

  it("rejects pointers that do not start with slash", () => {
    assert.throws(
      () => resolveJsonPointer({ booking_id: "FL_123" }, "booking_id"),
      /must start with/,
    );
  });

  it("rejects forbidden property segments", () => {
    for (const segment of ["__proto__", "prototype", "constructor"]) {
      assert.throws(
        () => resolveJsonPointer({}, `/${segment}`),
        /Security violation/,
      );
    }
  });

  it("returns undefined for a missing property", () => {
    assert.equal(resolveJsonPointer({}, "/missing"), undefined);
  });

  it("returns undefined when traversing through a primitive", () => {
    assert.equal(resolveJsonPointer({ id: 123 }, "/id/value"), undefined);
  });

  it("returns undefined for invalid array indexes", () => {
    const document = { items: ["a", "b"] };

    for (const pointer of [
      "/items/-1",
      "/items/01",
      "/items/1.0",
      "/items/1x",
      "/items/999999999999999999999999999999",
    ]) {
      assert.equal(resolveJsonPointer(document, pointer), undefined);
    }
  });

  it("returns undefined for an out-of-range array index", () => {
    assert.equal(resolveJsonPointer(["a"], "/5"), undefined);
  });
});

describe("buildCompensationPayload", () => {
  it("builds a compensation payload from a tool response", () => {
    const payload = buildCompensationPayload(
      {
        booking_id: {
          from: "response",
          pointer: "/booking_id",
        },
      },
      {},
      { booking_id: "FL_123", status: "confirmed" },
    );

    assert.equal(payload.booking_id, "FL_123");
    assert.equal(JSON.stringify(payload), '{"booking_id":"FL_123"}');
  });

  it("can extract compensation arguments from the original request", () => {
    const payload = buildCompensationPayload(
      {
        passenger_name: {
          from: "request",
          pointer: "/passenger_name",
        },
      },
      { passenger_name: "Alex" },
      {},
    );

    assert.equal(payload.passenger_name, "Alex");
  });

  it("supports multiple mappings", () => {
    const payload = buildCompensationPayload(
      {
        booking_id: {
          from: "response",
          pointer: "/booking_id",
        },
        passenger_name: {
          from: "request",
          pointer: "/passenger_name",
        },
      },
      { passenger_name: "Alex" },
      { booking_id: "FL_123" },
    );

    assert.equal(payload.booking_id, "FL_123");
    assert.equal(payload.passenger_name, "Alex");
  });

  it("rejects an empty compensation map", () => {
    assert.throws(
      () => buildCompensationPayload({}, {}, {}),
      /cannot be empty/,
    );
  });

  it("rejects a missing source payload", () => {
    assert.throws(
      () =>
        buildCompensationPayload(
          {
            booking_id: {
              from: "response",
              pointer: "/booking_id",
            },
          },
          {},
          null,
        ),
      /payload is missing/,
    );
  });

  it("rejects a missing mapped property", () => {
    assert.throws(
      () =>
        buildCompensationPayload(
          {
            booking_id: {
              from: "response",
              pointer: "/booking_id",
            },
          },
          {},
          { status: "confirmed" },
        ),
      /Compensation mapping failed/,
    );
  });

  it("rejects a mapped null value", () => {
    assert.throws(
      () =>
        buildCompensationPayload(
          {
            booking_id: {
              from: "response",
              pointer: "/booking_id",
            },
          },
          {},
          { booking_id: null },
        ),
      /Compensation mapping failed/,
    );
  });

  it("rejects malformed pointers in the map", () => {
    assert.throws(
      () =>
        buildCompensationPayload(
          {
            booking_id: {
              from: "response",
              pointer: "/booking~2id",
            },
          },
          {},
          { booking_id: "FL_123" },
        ),
      /Invalid RFC 6901 escape sequence/,
    );
  });

  it("rejects forbidden target fields", () => {
    const maliciousMap = JSON.parse(
      '{"__proto__":{"from":"response","pointer":"/booking_id"}}',
    );

    assert.throws(
      () =>
        buildCompensationPayload(maliciousMap, {}, { booking_id: "FL_123" }),
      /forbidden compensation target field/,
    );
  });

  it("rejects invalid mapping sources", () => {
    const invalidMap = {
      booking_id: {
        from: "database",
        pointer: "/booking_id",
      },
    };

    assert.throws(
      () =>
        buildCompensationPayload(
          invalidMap as never,
          {},
          { booking_id: "FL_123" },
        ),
      /Invalid source/,
    );
  });
});
