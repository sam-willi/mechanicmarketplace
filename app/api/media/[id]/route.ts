import { getMediaWithBytes } from "@/lib/data/mock/media-store";
import { getRepo } from "@/lib/data";
import { getSession, needs } from "@/lib/session";
import { serveHeaders } from "@/lib/media/policy";

/**
 * Serves uploaded media only to people with a reason to see it: the uploader,
 * the customer who owns the request or job, mechanics the request was sent to, and admins.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  // Type and disposition come from the bytes (lib/media/policy.ts): photos, video and recordings
  // inline, everything else (PDFs, and any older file that isn't one of those) as a download.
  const headers = serveHeaders(id, m.meta, m.bytes);
  const total = m.bytes.byteLength;
  // Byte ranges, which Safari needs to play video.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
    return new Response(m.bytes.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(m.bytes.slice(), { headers: { ...headers, "Content-Length": String(total) } });
}
