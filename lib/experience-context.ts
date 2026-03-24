import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { whopsdk } from "@/lib/whop-sdk";
import { ensureInternalUserFromWhop } from "@/lib/whop-app-user";

function hasWhopAccess(access: unknown): boolean {
	if (access == null) return false;
	const a = access as Record<string, unknown>;
	if (typeof a.has_access === "boolean") return a.has_access;
	if (a.access_level === "no_access") return false;
	return true;
}

export type ExperienceContext = {
	experienceId: string;
	experienceName: string;
	whopUserId: string;
	internalUserId: string;
	displayName: string;
};

async function loadExperienceContext(experienceId: string): Promise<ExperienceContext> {
	const h = await headers();
	const { userId: whopUserId } = await whopsdk.verifyUserToken(h);

	let experience: { name?: string | null };
	try {
		experience = await whopsdk.experiences.retrieve(experienceId);
	} catch {
		notFound();
	}

	const [user, access] = await Promise.all([
		whopsdk.users.retrieve(whopUserId),
		whopsdk.users.checkAccess(experienceId, { id: whopUserId }),
	]);

	if (!hasWhopAccess(access)) {
		notFound();
	}

	const u = user as { email?: string | null; name?: string | null; username?: string | null };
	const displayName = user.name || (user.username ? `@${user.username}` : "Member");
	const internalUserId = await ensureInternalUserFromWhop(whopUserId, {
		email: u.email,
		name: u.name,
		username: u.username,
	});

	return {
		experienceId,
		experienceName: experience.name?.trim() || "Experience",
		whopUserId,
		internalUserId,
		displayName,
	};
}

/** Deduped per request (layout + pages). */
export const requireExperienceContext = cache(loadExperienceContext);
