import { clearAdminSession } from "@/lib/session";

export async function POST() {
  await clearAdminSession();
  return Response.json({ ok: true });
}
