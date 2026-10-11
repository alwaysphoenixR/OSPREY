import { SideEffectClass } from "@prisma/client";
import { approveToolVersion } from "../discovery/approver.js";

async function main() {
  console.log("Testing rejection of an incomplete safety contract...");

  let rejected = false;

  try {
    await approveToolVersion({
      ospreyName: "mock-airline_book_flight",
      versionNumber: 1,
      sideEffectClass: SideEffectClass.REVERSIBLE,
      approvedBy: "admin@osprey.internal",
    });
  } catch (error) {
    rejected = true;
    console.log(
      "Expected rejection:",
      error instanceof Error ? error.message : error,
    );
  }

  if (!rejected) {
    throw new Error(
      "FAIL: Reversible tool was accepted without compensation details.",
    );
  }

  console.log("PASS: Incomplete reversible safety contract rejected.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
