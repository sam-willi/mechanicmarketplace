import { buildSeed } from "../lib/data/mock/seed";
import { toPublicProfile } from "../lib/domain/public-profile";
import { matchContext } from "../lib/domain/reputation";
const db = buildSeed();
for (const m of db.mechanics) {
  const src = {
    mechanic: m,
    screenings: db.screenings.filter((s) => s.mechanicId === m.id),
    insurance: db.insurance.filter((s) => s.mechanicId === m.id),
    credentials: db.credentials.filter((s) => s.mechanicId === m.id),
    employment: db.employment.filter((s) => s.mechanicId === m.id),
    pastRepairs: db.pastRepairs.filter((s) => s.mechanicId === m.id),
    reviews: db.reviews.filter((s) => s.mechanicId === m.id),
    verifications: db.verifications.filter((s) => s.mechanicId === m.id),
  };
  const p = toPublicProfile(src);
  const r = p.reputation;
  console.log(m.slug, "verified", r.verifiedRepairs, "rating", r.rating?.average.toFixed(2), r.rating?.count, "repeat", r.repeatCustomers,
    "| cats", r.byCategory.map((c) => `${c.category}:${c.count}`).join(","), "| makes", r.byMake.map((c) => `${c.make}:${c.count}`).join(","),
    "| safety", Object.entries(p.safety).map(([k, v]) => typeof v === "object" ? `${k}:${v.status}` : "").join(" "));
  if (m.slug === "derek-hall") console.log("  BMW brakes:", matchContext(src.pastRepairs, "brakes", "BMW")?.crossCount, "creds", p.credentials.map(c=>`${c.code}:${c.provenance}:${c.status}`).join(" "));
}
console.log("maya history", db.pastRepairs.filter(r=>r.customerId==="cust-maya").map(r=>`${r.year} ${r.model} ${r.title}`));
