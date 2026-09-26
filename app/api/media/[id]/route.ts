import { getMediaWithBytes } from "@/lib/data/mock/media-store";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";

/**
 * Serves uploaded media only to people with a reason to see it: the uploader,
 * the customer who owns the request or job, mechanics the request was sent to, and admins.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const repo = await getRepo();
  const { id } = await params;
  const m = await getMediaWithBytes(repo.scope, id);
  if (!m) return new Response("Not found", { status: 404 });
  // Only the records this viewer may see that the file is attached to (public repair photos and
  // portraits; their own request or job; a request they were sent).
  const s = await getSession();
  await (await needs(s)).media(id);
  // Photos attached to a repair record are part of the mechanic's public work gallery.
  // Repair-record photos and mechanic portraits are public, like the profile they're on.
  const publicRepairPhoto = Boolean(repo.findRepairWithPhoto(id)) || Boolean(repo.getMechanicByPhotoUrl(`/api/media/${id}`));
  if (!publicRepairPhoto && s.role === "guest") return new Response("Sign in to view", { status: 401 });
  const req = repo.findRequestWithMedia(id);
  const job = repo.findJobWithPhoto(id);
  const allowed =
    publicRepairPhoto ||
    (s.role !== "guest" && s.roles.includes("admin")) ||
    (s.role !== "guest" && m.ownerId === s.userId) ||
    (req && s.role === "customer" && req.customerId === s.customerId) ||
    (job && s.role === "customer" && job.customerId === s.customerId) ||
    (req && s.role === "mechanic" && req.matchedMechanicIds.includes(s.mechanicId));
  if (!allowed) return new Response("Not found", { status: 404 });
  return new Response(new Blob([m.bytes.slice().buffer as ArrayBuffer], { type: m.meta.contentType }), {
    headers: { "Content-Type": m.meta.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
