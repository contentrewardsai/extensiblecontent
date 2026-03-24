import { headers } from "next/headers";
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
 * Verifies Whop iframe token, experience access, and returns the internal Supabase user id.
 */
export async function requireExperienceActionUser(experienceId: string): Promise<{ internalUserId: string }> {
	const h = await headers();
	const { userId: whopUserId } = await whopsdk.verifyUserToken(h);
	const access = await whopsdk.users.checkAccess(experienceId, { id: whopUserId });
	if (!hasWhopAccess(access)) {
		throw new Error("Access denied");
	}
	const user = await whopsdk.users.retrieve(whopUserId);
	const u = user as { email?: string | null; name?: string | null; username?: string | null };
	const internalUserId = await ensureInternalUserFromWhop(whopUserId, {
		email: u.email,
		name: u.name,
		username: u.username,
	});
	return { internalUserId };
}
