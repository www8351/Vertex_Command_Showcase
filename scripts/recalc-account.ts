import { recalculateAccountStatus } from "../server/rule-engine";
import { storage } from "../server/storage";

async function main() {
  const id = parseInt(process.argv[2] || "0", 10);
  if (!id) {
    console.error("usage: tsx scripts/recalc-account.ts <accountId>");
    process.exit(1);
  }

  const before = await storage.getAccount(id);
  if (!before) {
    console.error(`account ${id} not found`);
    process.exit(1);
  }

  console.log(`[before] id=${id} status=${before.status} stage=${before.stage} balance=${before.balance} size=${before.size} target=${before.target} brokerActive=${before.brokerActive}`);

  const newStatus = await recalculateAccountStatus(id);

  const after = await storage.getAccount(id);
  console.log(`[after]  id=${id} status=${after?.status} (computed=${newStatus})`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
