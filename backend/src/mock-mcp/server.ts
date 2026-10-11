// src/mock-mcp/server.ts

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();
// Toggle this to test schema drift.
// Read once when the process starts.
const SIMULATE_DRIFT = process.env.SIMULATE_DRIFT === "true";
console.log(SIMULATE_DRIFT);

// --------------------------------------------------
// 1. In-memory state for mock bookings and payments
// --------------------------------------------------

type Booking = {
  destination: string;
  passengerName: string;
  status: "CONFIRMED" | "CANCELLED";
};

type Payment = {
  amount: number;
  status: "SUCCEEDED";
};

const bookings = new Map<string, Booking>();
const payments = new Map<string, Payment>();

// --------------------------------------------------
// 2. Create the MCP server
// --------------------------------------------------

const server = new McpServer({
  name: "mock-airline-mcp",
  version: "1.0.0",
});

// --------------------------------------------------
// 3. Helpers for consistent MCP tool responses
// --------------------------------------------------

function toolError(message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

function toolSuccess(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data),
      },
    ],
  };
}

// --------------------------------------------------
// 4. Define book_flight input schema
// --------------------------------------------------

const bookFlightInputSchema = {
  destination: z.string().trim().min(1),
  passenger_name: z.string().trim().min(1),

  // This field is introduced when schema drift is enabled.
  ...(SIMULATE_DRIFT ? { passport_number: z.string().trim().min(1) } : {}),
};

// --------------------------------------------------
// 5. Register book_flight
// --------------------------------------------------

server.registerTool(
  "book_flight",
  {
    description: "Books a flight for a passenger.",
    inputSchema: bookFlightInputSchema,
  },
  async (args) => {
    const destination = args.destination;
    const passengerName = args.passenger_name;

    // Extra defensive check for the drift scenario.
    if (
      SIMULATE_DRIFT &&
      (!("passport_number" in args) ||
        typeof args.passport_number !== "string" ||
        !args.passport_number.trim())
    ) {
      return toolError(
        "passport_number is required by the current tool schema.",
      );
    }

    const bookingId = `FLIGHT_${randomUUID()}`;

    bookings.set(bookingId, {
      destination,
      passengerName,
      status: "CONFIRMED",
    });

    console.error(`[Mock Server] Created booking ${bookingId}`);

    return toolSuccess({
      status: "success",
      booking_id: bookingId,
      destination,
      message: `Flight booked to ${destination}.`,
    });
  },
);

// --------------------------------------------------
// 6. Register cancel_flight
// --------------------------------------------------

server.registerTool(
  "cancel_flight",
  {
    description: "Cancels an existing flight booking.",
    inputSchema: {
      booking_id: z.string().trim().min(1),
    },
  },
  async ({ booking_id }) => {
    const booking = bookings.get(booking_id);

    if (!booking) {
      return toolError(`Booking '${booking_id}' was not found.`);
    }

    if (booking.status === "CANCELLED") {
      return toolError(`Booking '${booking_id}' is already cancelled.`);
    }

    booking.status = "CANCELLED";

    console.error(`[Mock Server] Cancelled booking ${booking_id}`);

    return toolSuccess({
      status: "success",
      booking_id,
      message: `Booking '${booking_id}' has been cancelled.`,
    });
  },
);

// --------------------------------------------------
// 7. Register charge_card
// --------------------------------------------------

server.registerTool(
  "charge_card",
  {
    description: "Charges a payment token for a specified amount.",
    inputSchema: {
      amount: z.number().finite().positive(),
      token: z.string().trim().min(1),
    },
  },
  async ({ amount, token }) => {
    // Never log the payment token.

    // Deterministic simulated business failure.
    if (amount > 10000) {
      return toolError("Card declined: simulated insufficient funds.");
    }

    const transactionId = `TX_${randomUUID()}`;

    // This is a mock ledger, not a real payment processor.
    payments.set(transactionId, {
      amount,
      status: "SUCCEEDED",
    });

    console.error(`[Mock Server] Recorded simulated payment ${transactionId}`);

    return toolSuccess({
      status: "success",
      transaction_id: transactionId,
      amount_charged: amount,
    });
  },
);

// --------------------------------------------------
// 8. Start the MCP server over STDIO
// --------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Use stderr for logs. stdout is reserved for MCP messages.
  console.error(
    `[Mock Server] Running on STDIO. Schema drift: ${SIMULATE_DRIFT}`,
  );
}

main().catch((error: unknown) => {
  console.error("[Mock Server] Fatal error:", error);
  process.exitCode = 1;
});
