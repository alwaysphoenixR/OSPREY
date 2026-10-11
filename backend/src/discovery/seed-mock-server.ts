import { PrismaClient, McpTransportType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const server = await prisma.mcpServer.upsert({
    where: { serverKey: "mock-airline" },
    update: {
      displayName: "Mock Airline MCP",
      transportType: McpTransportType.STDIO,
      command: "node",
      args: ["./node_modules/tsx/dist/cli.mjs", "src/mock-mcp/server.ts"],
      endpointUrl: null,
      isEnabled: true,
    },
    create: {
      serverKey: "mock-airline",
      displayName: "Mock Airline MCP",
      transportType: McpTransportType.STDIO,
      command: "node",
      args: ["./node_modules/tsx/dist/cli.mjs", "src/mock-mcp/server.ts"],
    },
  });

  console.log("Registered server:", server);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
