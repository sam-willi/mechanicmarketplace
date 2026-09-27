/** Run as a separate OS process by normalized.test.ts: renames the given live users through its own store instance. */
import { liveSlice, repoOver } from "@/lib/data";
import { NormalizedLiveStore } from "@/lib/data/normalized/store";

async function main() {
  const reads = process.env.CLUTCH_TEST_READS === "targeted" ? "targeted" : "snapshot";
  const store = NormalizedLiveStore.connect(process.env.DATABASE_URL!, { cacheMs: 0, reads });
  const repo = reads === "targeted" ? liveSlice(store).repo : repoOver("live", store);
  try {
    await store.ready("force");
    await Promise.all(process.argv.slice(2).map((id) => repo.updateUser(id, { name: `child ${id}` })));
  } finally {
    await store.end();
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
