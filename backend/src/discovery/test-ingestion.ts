import { ingestToolsFromServer } from "./ingester.js";

async function main() {
  await ingestToolsFromServer("mock-airline");
}

main().catch((error) => {
  console.error("[Test] Ingestion failed:", error);
  process.exitCode = 1;
});
