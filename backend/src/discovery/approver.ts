import {
  PrismaClient,
  SideEffectClass,
  ToolApprovalStatus,
  Prisma,
} from "@prisma/client";

import type { CompensationMap } from "../types/compensation.js";
import { validateCompensationMap } from "../utils/json-pointer.js";

const prisma = new PrismaClient();

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
 * Approves a specific ToolVersion after validating its safety contract.
 *
 * IMPORTANT:
 * This version validates compensation-map structure and verifies that
 * referenced compensating/reconciliation tools exist in the registry.
 *
 * Exact compensating-version approval checks and safe approval-state
 * transition enforcement remain planned hardening work.
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

  // 1. Resolve the exact ToolDefinition and ToolVersion.
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

  // 2. Validate contracts for REVERSIBLE operations.
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

    // Use the shared runtime validator.
    validateCompensationMap(compensationMap);

    // Verify that the compensating tool exists in the registry.
    // Checking its exact approved version is deferred to the hardening pass.
    const compToolDef = await prisma.toolDefinition.findUnique({
      where: { ospreyName: compensatingTool },
    });

    if (!compToolDef) {
      throw new Error(
        `Compensating tool "${compensatingTool}" was not found in the ToolDefinition registry.`,
      );
    }
  }

  // 3. Verify the reconciliation tool exists, if specified.
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

  // 4. Persist the approval for this exact ToolVersion.
  // NOTE: The current upsert can reapprove a suspended version.
  // Safe transition enforcement is intentionally deferred.
  const approvalData = {
    status: ToolApprovalStatus.APPROVED,
    sideEffectClass,
    requiresHumanAuth,
    compensatingTool: compensatingTool ?? null,
    compensationMap:
      (compensationMap as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    reconciliationTool: reconciliationTool ?? null,
    approvedBy,
    approvedAt: new Date(),
    reviewNotes: reviewNotes ?? "Approved via Safety Contract Service.",
  };

  const approval = await prisma.toolApproval.upsert({
    where: { toolVersionId: toolVersion.id },
    update: approvalData,
    create: {
      toolVersionId: toolVersion.id,
      ...approvalData,
    },
  });

  console.log(
    `[Approver] Approved ${ospreyName} (v${versionNumber}) as ${sideEffectClass}.`,
  );

  return approval;
}

/**
 * Emergency kill-switch to suspend a specific ToolVersion.
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

  return prisma.toolApproval.update({
    where: { toolVersionId: toolVersion.id },
    data: {
      status: ToolApprovalStatus.SUSPENDED,
      reviewNotes: `SUSPENDED: ${reason}`,
    },
  });
}
