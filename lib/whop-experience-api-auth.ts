import type { NextRequest } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { ensureInternalUserFromWhop } from "@/lib/whop-app-user";

function hasWhopAccess(access: unknown): boolean {
	if (access == null) return false;
	const a = access as Record<string, unknown>;
	if (typeof a.has_access === "boolean") return a.has_access;
	if (a.access_level === "no_access") return false;
	return true;
}

/**
 * Verify Whop user token (cookies) and that the user has access to the experience, then
 * return the internal Supabase user id. For `/api/whop/...` cookie-auth routes.
 */
export async function getInternalUserForExperience(
	request: NextRequest,
	experienceId: string,
): Promise<
	{ ok: true; internalUserId: string; whopUserId: string } | { ok: false; response: Response }
> {
	if (!experienceId) {
		return { ok: false, response: Response.json({ error: "experienceId is required" }, { status: 400 }) };
	}
	const h = new Headers();
	const cookie = request.headers.get("cookie");
	if (cookie) h.set("cookie", cookie);

	let whopUserId: string;
	try {
		({ userId: whopUserId } = await whopsdk.verifyUserToken(h));
	} catch {
		return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
	}

	const access = await whopsdk.users.checkAccess(experienceId, { id: whopUserId });
	if (!hasWhopAccess(access)) {
		return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
	}

	const user = await whopsdk.users.retrieve(whopUserId);
	const u = user as { email?: string | null; name?: string | null; username?: string | null };
	const internalUserId = await ensureInternalUserFromWhop(whopUserId, {
		email: u.email,
		name: u.name,
		username: u.username,
	});
	return { ok: true, internalUserId, whopUserId };
}
