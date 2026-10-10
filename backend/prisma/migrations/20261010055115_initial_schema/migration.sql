-- CreateEnum
CREATE TYPE "McpTransportType" AS ENUM ('STDIO', 'STREAMABLE_HTTP', 'SSE');

-- CreateEnum
CREATE TYPE "SideEffectClass" AS ENUM ('READ_ONLY', 'REVERSIBLE', 'IRREVERSIBLE');

-- CreateEnum
CREATE TYPE "ToolApprovalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'ROLLING_BACK', 'ROLLED_BACK', 'COMPLETED', 'FAILED', 'MANUAL_INTERVENTION_REQUIRED');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('PENDING_APPROVAL', 'READY', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN', 'COMPENSATING', 'COMPENSATED', 'COMPENSATION_FAILED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('PREPARED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('EXECUTE', 'RECONCILE', 'COMPENSATE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('HELD', 'READY', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeadLetterStatus" AS ENUM ('UNRESOLVED', 'RESOLVED_RETRY', 'RESOLVED_FORCE', 'RESOLVED_CANCELLED');

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL,
    "serverKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "transportType" "McpTransportType" NOT NULL,
    "endpointUrl" TEXT,
    "command" TEXT,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authRef" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_definitions" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "upstreamName" TEXT NOT NULL,
    "ospreyName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_versions" (
    "id" TEXT NOT NULL,
    "toolDefId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "inputJsonSchema" JSONB NOT NULL,
    "outputJsonSchema" JSONB,
    "annotations" JSONB,
    "canonicalHash" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_approvals" (
    "id" TEXT NOT NULL,
    "toolVersionId" TEXT NOT NULL,
    "status" "ToolApprovalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "sideEffectClass" "SideEffectClass" NOT NULL,
    "requiresHumanAuth" BOOLEAN NOT NULL DEFAULT false,
    "compensatingTool" TEXT,
    "compensationMap" JSONB,
    "reconciliationTool" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_sessions" (
    "session_id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "rollbackStartedAt" TIMESTAMP(3),
    "rollbackCompletedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "dag_nodes" (
    "node_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "toolVersionId" TEXT NOT NULL,
    "ospreyToolName" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "status" "NodeStatus" NOT NULL DEFAULT 'READY',
    "idempotencyScope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "sideEffectClass" "SideEffectClass" NOT NULL,
    "executionOrder" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "providerOperationId" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dag_nodes_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "dag_dependencies" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,

    CONSTRAINT "dag_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_attempts" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'PREPARED',
    "providerIdempotencyKey" TEXT,
    "providerRequestId" TEXT,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "effect_outbox" (
    "outbox_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" "OutboxKind" NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'HELD',
    "payload" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "effect_outbox_pkey" PRIMARY KEY ("outbox_id")
);

-- CreateTable
CREATE TABLE "dead_letter_queue" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "node_id" TEXT,
    "failedAction" TEXT NOT NULL,
    "errorReason" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "status" "DeadLetterStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "dead_letter_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_serverKey_key" ON "mcp_servers"("serverKey");

-- CreateIndex
CREATE UNIQUE INDEX "tool_definitions_ospreyName_key" ON "tool_definitions"("ospreyName");

-- CreateIndex
CREATE UNIQUE INDEX "tool_definitions_serverId_upstreamName_key" ON "tool_definitions"("serverId", "upstreamName");

-- CreateIndex
CREATE UNIQUE INDEX "tool_versions_toolDefId_versionNumber_key" ON "tool_versions"("toolDefId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tool_versions_toolDefId_canonicalHash_key" ON "tool_versions"("toolDefId", "canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "tool_approvals_toolVersionId_key" ON "tool_approvals"("toolVersionId");

-- CreateIndex
CREATE INDEX "tool_approvals_status_idx" ON "tool_approvals"("status");

-- CreateIndex
CREATE INDEX "workflow_sessions_principalId_created_at_idx" ON "workflow_sessions"("principalId", "created_at");

-- CreateIndex
CREATE INDEX "workflow_sessions_status_updated_at_idx" ON "workflow_sessions"("status", "updated_at");

-- CreateIndex
CREATE INDEX "dag_nodes_session_id_status_idx" ON "dag_nodes"("session_id", "status");

-- CreateIndex
CREATE INDEX "dag_nodes_toolVersionId_idx" ON "dag_nodes"("toolVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "dag_nodes_idempotencyScope_idempotencyKey_key" ON "dag_nodes"("idempotencyScope", "idempotencyKey");

-- CreateIndex
CREATE INDEX "dag_dependencies_toNodeId_idx" ON "dag_dependencies"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "dag_dependencies_fromNodeId_toNodeId_key" ON "dag_dependencies"("fromNodeId", "toNodeId");

-- CreateIndex
CREATE INDEX "execution_attempts_status_createdAt_idx" ON "execution_attempts"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "execution_attempts_nodeId_attemptNumber_key" ON "execution_attempts"("nodeId", "attemptNumber");

-- CreateIndex
CREATE INDEX "effect_outbox_status_availableAt_idx" ON "effect_outbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "effect_outbox_session_id_idx" ON "effect_outbox"("session_id");

-- CreateIndex
CREATE INDEX "effect_outbox_nodeId_kind_idx" ON "effect_outbox"("nodeId", "kind");

-- CreateIndex
CREATE INDEX "dead_letter_queue_status_createdAt_idx" ON "dead_letter_queue"("status", "createdAt");

-- CreateIndex
CREATE INDEX "dead_letter_queue_session_id_idx" ON "dead_letter_queue"("session_id");

-- AddForeignKey
ALTER TABLE "tool_definitions" ADD CONSTRAINT "tool_definitions_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "mcp_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_versions" ADD CONSTRAINT "tool_versions_toolDefId_fkey" FOREIGN KEY ("toolDefId") REFERENCES "tool_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_approvals" ADD CONSTRAINT "tool_approvals_toolVersionId_fkey" FOREIGN KEY ("toolVersionId") REFERENCES "tool_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dag_nodes" ADD CONSTRAINT "dag_nodes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workflow_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dag_nodes" ADD CONSTRAINT "dag_nodes_toolVersionId_fkey" FOREIGN KEY ("toolVersionId") REFERENCES "tool_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dag_dependencies" ADD CONSTRAINT "dag_dependencies_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "dag_nodes"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dag_dependencies" ADD CONSTRAINT "dag_dependencies_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "dag_nodes"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "dag_nodes"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effect_outbox" ADD CONSTRAINT "effect_outbox_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workflow_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effect_outbox" ADD CONSTRAINT "effect_outbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "dag_nodes"("node_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_queue" ADD CONSTRAINT "dead_letter_queue_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workflow_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_queue" ADD CONSTRAINT "dead_letter_queue_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "dag_nodes"("node_id") ON DELETE SET NULL ON UPDATE CASCADE;
