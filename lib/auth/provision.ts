import "server-only";
import { repo } from "@/lib/data";
import { VEHICLE_MAKES, type User, type VehicleMake } from "@/lib/domain/types";

export type SignupMeta = {
  name?: string;
  full_name?: string;
  avatar_url?: string;
  picture?: string;
  role?: string;
  phone?: string;
  car?: { year?: number; make?: string; model?: string; mileage?: number };
};

/**
 * Create the Clutch account for a Supabase Auth user the first time they're
 * signed in. Name, role and phone come from what they entered at sign-up
 * (auth user metadata) or, for Google, from Google plus the role they picked.
 * Returns undefined when no role is known yet (send them to /welcome).
 */
export async function provisionUser(auth: { id: string; email: string; meta: Record<string, unknown> }, roleOverride?: "customer" | "mechanic"): Promise<User | undefined> {
  const existing = repo.getUser(auth.id);
  if (existing) {
    if (isStaff(auth.email) && !existing.roles.includes("admin")) await repo.grantAdmin(existing.id);
    return existing;
  }
  const meta = auth.meta as SignupMeta;
  const role = roleOverride ?? (meta.role === "mechanic" || meta.role === "customer" ? meta.role : undefined);
  if (!role) return undefined;
  const user = await repo.createUser({
    id: auth.id,
    name: meta.name || meta.full_name || auth.email.split("@")[0],
    email: auth.email,
    phone: meta.phone || undefined,
    role,
    avatarUrl: meta.avatar_url || meta.picture || undefined,
  });
  if (isStaff(auth.email)) await repo.grantAdmin(user.id);
  const car = meta.car;
  if (role === "customer" && car?.model && VEHICLE_MAKES.includes(car.make as VehicleMake)) {
    const c = repo.getCustomerByUser(user.id);
    if (c) await repo.addVehicle(c.id, { year: car.year || 2015, make: car.make as VehicleMake, model: car.model, mileage: car.mileage || undefined });
  }
  return user;
}

/** Clutch staff: accounts whose (verified) email is listed in CLUTCH_ADMIN_EMAILS get the reviewer role. */
function isStaff(email: string) {
  const admins = (process.env.CLUTCH_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Boolean(email) && admins.includes(email.toLowerCase());
}

/** Where a freshly signed-in user should land. */
export function homeFor(user: User, next?: string | null) {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  // Staff land in their own app like anyone else; the review queue is in the account menu.
  if (user.roles.includes("customer")) return "/customer";
  if (user.roles.includes("mechanic")) return "/mechanic";
  return user.roles.includes("admin") ? "/admin" : "/customer";
}
