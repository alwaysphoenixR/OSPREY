import {
  PrismaClient,
  McpTransportType,
  SideEffectClass,
  ToolApprovalStatus,
} from "@prisma/client";

import { ingestToolsFromServer } from "../discovery/ingester.js";
import { approveToolVersion } from "../discovery/approver.js";

const prisma = new PrismaClient();

async function main() {
  console.log("\n=== STEP 1: Configure mock server ===");

  await prisma.mcpServer.upsert({
    where: { serverKey: "mock-airline" },
    update: {
      command: "node",
      args: ["./node_modules/tsx/dist/cli.mjs", "src/mock-mcp/server.ts"],
      isEnabled: true,
    },
    create: {
      serverKey: "mock-airline",
      displayName: "Mock Airline MCP",
      transportType: McpTransportType.STDIO,
      command: "node",
      args: ["./node_modules/tsx/dist/cli.mjs", "src/mock-mcp/server.ts"],
      isEnabled: true,
    },
  });

  console.log("Mock server configuration ready.");

  console.log("\n=== STEP 2: Run discovery and ingestion ===");

  await ingestToolsFromServer("mock-airline");

  console.log("Ingestion completed.");

  console.log("\n=== STEP 3: Approve cancel_flight v1 ===");

  await approveToolVersion({
    ospreyName: "mock-airline_cancel_flight",
    versionNumber: 1,
    sideEffectClass: SideEffectClass.IRREVERSIBLE,
    requiresHumanAuth: true,
    approvedBy: "admin@osprey.internal",
    reviewNotes:
      "Mock cancellation changes booking state and has no restoration operation.",
  });

  console.log("\n=== STEP 4: Approve book_flight v1 ===");

  await approveToolVersion({
    ospreyName: "mock-airline_book_flight",
    versionNumber: 1,
    sideEffectClass: SideEffectClass.REVERSIBLE,
    requiresHumanAuth: false,
    compensatingTool: "mock-airline_cancel_flight",
    compensationMap: {
      booking_id: {
        from: "response",
        pointer: "/booking_id",
      },
    },
    approvedBy: "admin@osprey.internal",
    reviewNotes:
      "Mock booking can be compensated by cancellation using the returned booking_id.",
  });

  console.log("\n=== STEP 5: Approve charge_card v1 ===");

  await approveToolVersion({
    ospreyName: "mock-airline_charge_card",
    versionNumber: 1,
    sideEffectClass: SideEffectClass.IRREVERSIBLE,
    requiresHumanAuth: true,
    approvedBy: "admin@osprey.internal",
    reviewNotes:
      "Mock payment is irreversible and requires human authorization.",
  });

  console.log("\n=== STEP 6: Verify database records ===");

  const tools = await prisma.toolDefinition.findMany({
    where: {
      server: { serverKey: "mock-airline" },
    },
    include: {
      versions: {
        orderBy: { versionNumber: "asc" },
        include: { approval: true },
      },
    },
    orderBy: { ospreyName: "asc" },
  });

  for (const tool of tools) {
    for (const version of tool.versions) {
      console.log({
        tool: tool.ospreyName,
        version: version.versionNumber,
        hash: version.canonicalHash.slice(0, 12),
        status: version.approval?.status ?? "NO APPROVAL",
        sideEffectClass: version.approval?.sideEffectClass ?? "NOT CLASSIFIED",
        requiresHumanAuth: version.approval?.requiresHumanAuth,
        compensatingTool: version.approval?.compensatingTool,
        compensationMap: version.approval?.compensationMap,
      });
    }
  }

  const book = tools.find(
    (tool) => tool.ospreyName === "mock-airline_book_flight",
  );

  const bookV1 = book?.versions.find((version) => version.versionNumber === 1);

  if (
    bookV1?.approval?.status !== ToolApprovalStatus.APPROVED ||
    bookV1.approval.sideEffectClass !== SideEffectClass.REVERSIBLE ||
    bookV1.approval.compensatingTool !== "mock-airline_cancel_flight"
  ) {
    throw new Error("Book flight v1 safety contract verification failed.");
  }

  const bookV2 = book?.versions.find((version) => version.versionNumber === 2);

  if (bookV2 && bookV2.approval?.status !== ToolApprovalStatus.PENDING_REVIEW) {
    throw new Error("Expected book_flight v2 to remain PENDING_REVIEW.");
  }

  console.log("\nPASS: Book flight v1 safety contract verified.");

  if (bookV2) {
    console.log("PASS: Book flight v2 remains pending review.");
  }

  console.log("\n=== PHASE 2 + APPROVER VERIFICATION COMPLETE ===");
}

main()
  .catch((error) => {
    console.error("\nVerification failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
