// src/discovery/approver.ts
import {
  PrismaClient,
  SideEffectClass,
  ToolApprovalStatus,
  Prisma,
} from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Strict declarative mapping for RFC 6901 JSON Pointers.
 * Example:
 * {
 *   "booking_id": { "from": "response", "pointer": "/booking_id" }
 * }
 */
export interface CompensationFieldPointer {
  from: "request" | "response";
  pointer: string; // Must be a valid RFC 6901 JSON pointer starting with '/'
}

export type CompensationMap = Record<string, CompensationFieldPointer>;

export interface SafetyContractInput {
  ospreyName: string;
  versionNumber: number;
  sideEffectClass: SideEffectClass;
  requiresHumanAuth?: boolean;
  compensatingTool?: string;
  compensationMap?: CompensationMap;
  reconciliationTool?: string;
  approvedBy: string;
  reviewNotes?: string;
}

/**
 * Validates that a compensation map adheres strictly to RFC 6901 JSON Pointer syntax
 * and only references 'request' or 'response' sources.
 */
function validateCompensationMap(map: CompensationMap): void {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    throw new Error(
      "compensationMap cannot be an empty object for a REVERSIBLE tool.",
    );
  }

  for (const [targetField, rule] of entries) {
    if (!targetField || typeof targetField !== "string") {
      throw new Error("Invalid target field name in compensationMap.");
    }
    if (rule.from !== "request" && rule.from !== "response") {
      throw new Error(
        `Invalid source "${rule.from}" for field "${targetField}". Must be "request" or "response".`,
      );
    }
    if (typeof rule.pointer !== "string" || !rule.pointer.startsWith("/")) {
      throw new Error(
        `Invalid RFC 6901 pointer "${rule.pointer}" for field "${targetField}". Pointers must start with "/".`,
      );
    }
  }
}

/**
 * Promotes a specific ToolVersion from PENDING_REVIEW to APPROVED
 * after validating its safety and compensation contract.
 */
export async function approveToolVersion(input: SafetyContractInput) {
  const {
    ospreyName,
    versionNumber,
    sideEffectClass,
    requiresHumanAuth = false,
    compensatingTool,
    compensationMap,
    reconciliationTool,
    approvedBy,
    reviewNotes,
  } = input;

  // 1. Resolve the exact ToolDefinition and pinned ToolVersion
  const toolDef = await prisma.toolDefinition.findUnique({
    where: { ospreyName },
    include: {
      versions: {
        where: { versionNumber },
        include: { approval: true },
      },
    },
  });

  if (!toolDef) {
    throw new Error(`ToolDefinition "${ospreyName}" not found.`);
  }

  const toolVersion = toolDef.versions[0];
  if (!toolVersion) {
    throw new Error(
      `Version ${versionNumber} for tool "${ospreyName}" does not exist.`,
    );
  }

  // 2. Enforce strict contract rules for REVERSIBLE operations
  if (sideEffectClass === SideEffectClass.REVERSIBLE) {
    if (!compensatingTool) {
      throw new Error(
        `Tool "${ospreyName}" v${versionNumber} is marked REVERSIBLE and must specify a compensatingTool.`,
      );
    }
    if (!compensationMap) {
      throw new Error(
        `Tool "${ospreyName}" v${versionNumber} is marked REVERSIBLE and must specify a compensationMap.`,
      );
    }

    // Validate RFC 6901 pointer syntax
    validateCompensationMap(compensationMap);

    // Ensure the compensating tool exists in OSPREY's registry
    const compToolDef = await prisma.toolDefinition.findUnique({
      where: { ospreyName: compensatingTool },
    });
    if (!compToolDef) {
      throw new Error(
        `Compensating tool "${compensatingTool}" was not found in the ToolDefinition registry.`,
      );
    }
  }

  // 3. Verify reconciliation tool exists if specified
  if (reconciliationTool) {
    const reconToolDef = await prisma.toolDefinition.findUnique({
      where: { ospreyName: reconciliationTool },
    });
    if (!reconToolDef) {
      throw new Error(
        `Reconciliation tool "${reconciliationTool}" was not found in the ToolDefinition registry.`,
      );
    }
  }

  // 4. Upsert and lock in the APPROVED contract for this specific ToolVersion
  const approval = await prisma.toolApproval.upsert({
    where: { toolVersionId: toolVersion.id },
    update: {
      status: ToolApprovalStatus.APPROVED,
      sideEffectClass,
      requiresHumanAuth,
      compensatingTool: compensatingTool ?? null,
      compensationMap:
        (compensationMap as unknown as Prisma.InputJsonValue) ??
        Prisma.JsonNull,
      reconciliationTool: reconciliationTool ?? null,
      approvedBy,
      approvedAt: new Date(),
      reviewNotes: reviewNotes ?? "Approved via Safety Contract Service.",
    },
    create: {
      toolVersionId: toolVersion.id,
      status: ToolApprovalStatus.APPROVED,
      sideEffectClass,
      requiresHumanAuth,
      compensatingTool: compensatingTool ?? null,
      compensationMap:
        (compensationMap as unknown as Prisma.InputJsonValue) ??
        Prisma.JsonNull,
      reconciliationTool: reconciliationTool ?? null,
      approvedBy,
      approvedAt: new Date(),
      reviewNotes: reviewNotes ?? "Approved via Safety Contract Service.",
    },
  });

  console.log(
    `[Approver] Approved ${ospreyName} (v${versionNumber}) as ${sideEffectClass}.`,
  );

  return approval;
}

/**
 * Emergency kill-switch to suspend an approved ToolVersion immediately.
 */
export async function suspendToolVersion(
  ospreyName: string,
  versionNumber: number,
  reason: string,
) {
  const toolDef = await prisma.toolDefinition.findUnique({
    where: { ospreyName },
    include: {
      versions: {
        where: { versionNumber },
      },
    },
  });

  const toolVersion = toolDef?.versions[0];
  if (!toolVersion) {
    throw new Error(
      `Cannot suspend: ${ospreyName} v${versionNumber} not found.`,
    );
  }

  return await prisma.toolApproval.update({
    where: { toolVersionId: toolVersion.id },
    data: {
      status: ToolApprovalStatus.SUSPENDED,
      reviewNotes: `SUSPENDED: ${reason}`,
    },
  });
}
