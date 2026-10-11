import { PrismaClient, McpTransportType, Prisma } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { canonicalHash } from "../utils/hash.js";

const prisma = new PrismaClient();

/**
 * Validates database config and instantiates the correct MCP Transport.
 */
function createTransport(server: {
  transportType: McpTransportType;
  command: string | null;
  args: string[];
  endpointUrl: string | null;
}): Transport {
  switch (server.transportType) {
    case McpTransportType.STDIO: {
      if (!server.command) {
        throw new Error("Transport STDIO requires a valid command string.");
      }

      return new StdioClientTransport({
        command: server.command,
        args: server.args,
      });
    }

    case McpTransportType.SSE: {
      if (!server.endpointUrl) {
        throw new Error("Transport SSE requires a valid endpointUrl.");
      }

      // Legacy transport: retain support for SSE-only MCP servers.
      return new SSEClientTransport(new URL(server.endpointUrl));
    }

    case McpTransportType.STREAMABLE_HTTP: {
      if (!server.endpointUrl) {
        throw new Error(
          "Transport STREAMABLE_HTTP requires a valid endpointUrl.",
        );
      }

      return new StreamableHTTPClientTransport(
        new URL(server.endpointUrl),
      ) as Transport;
    }

    default:
      throw new Error(`Unsupported transport type: ${server.transportType}`);
  }
}

/**
 * Discovers upstream MCP tools, detects semantic changes,
 * and updates the local OSPREY registry.
 */
export async function ingestToolsFromServer(serverKey: string): Promise<void> {
  console.log(`[Discovery] Initiating sync for server: ${serverKey}`);

  const server = await prisma.mcpServer.findUnique({
    where: { serverKey },
  });

  if (!server || !server.isEnabled) {
    throw new Error(`Server '${serverKey}' not found or is disabled.`);
  }

  const transport = createTransport(server);

  const mcpClient = new Client(
    { name: "osprey-discovery-worker", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await mcpClient.connect(transport);

    const response = await mcpClient.listTools();

    console.log(
      `[Discovery] Found ${response.tools.length} tools. Processing...`,
    );

    for (const upstreamTool of response.tools) {
      // 1. Hash the tool's semantic identity.
      const toolIdentity = {
        name: upstreamTool.name,
        description: upstreamTool.description || "",
        inputSchema: upstreamTool.inputSchema,
      };

      const schemaHash = canonicalHash(toolIdentity);

      // 2. Upsert the logical ToolDefinition.
      const toolDef = await prisma.toolDefinition.upsert({
        where: {
          serverId_upstreamName: {
            serverId: server.id,
            upstreamName: upstreamTool.name,
          },
        },
        update: {
          description: upstreamTool.description || "",
        },
        create: {
          serverId: server.id,
          upstreamName: upstreamTool.name,
          ospreyName: `${server.serverKey}_${upstreamTool.name}`,
          description: upstreamTool.description || "",
        },
      });

      // 3. Create a version only when the semantic hash is new.
      await prisma.$transaction(async (tx) => {
        const existingVersion = await tx.toolVersion.findUnique({
          where: {
            toolDefId_canonicalHash: {
              toolDefId: toolDef.id,
              canonicalHash: schemaHash,
            },
          },
        });

        if (existingVersion) {
          return;
        }

        const latestVersion = await tx.toolVersion.findFirst({
          where: { toolDefId: toolDef.id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });

        const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

        try {
          const newVersion = await tx.toolVersion.create({
            data: {
              toolDefId: toolDef.id,
              versionNumber: nextVersionNumber,
              inputJsonSchema: upstreamTool.inputSchema as any,
              canonicalHash: schemaHash,
            },
          });

          // New versions never inherit previous approvals.
          await tx.toolApproval.create({
            data: {
              toolVersionId: newVersion.id,
              status: "PENDING_REVIEW",
              sideEffectClass: "IRREVERSIBLE",
              requiresHumanAuth: true,
              reviewNotes:
                "Provisional discovery entry. Pending administrator safety review.",
            },
          });

          console.log(
            `[Discovery] New version v${nextVersionNumber} created for ${toolDef.ospreyName}.`,
          );
        } catch (error) {
          // Handle a concurrent worker creating the same unique record.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return;
          }

          throw error;
        }
      });
    }

    // 4. Update discovery health only after successful synchronization.
    await prisma.mcpServer.update({
      where: { id: server.id },
      data: { lastDiscoveredAt: new Date() },
    });

    console.log(`[Discovery] Sync complete for ${serverKey}.`);
  } finally {
    // 5. Close the transport and release resources.
    try {
      await mcpClient.close();
    } catch (cleanupErr) {
      console.error(
        `[Discovery] Failed to close MCP client for ${serverKey}:`,
        cleanupErr,
      );

      // Best-effort cleanup if client closure fails.
      try {
        await transport.close();
      } catch (transportErr) {
        console.error(
          `[Discovery] Failed to close transport for ${serverKey}:`,
          transportErr,
        );
      }
    }
  }
}
