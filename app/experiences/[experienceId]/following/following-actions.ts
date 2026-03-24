"use server";

import { revalidatePath } from "next/cache";
import { requireExperienceActionUser } from "@/lib/experience-action-auth";
import { createFollowingForUser, deleteFollowingForUser, updateFollowingForUser } from "@/lib/following-mutations";
import { getServiceSupabase } from "@/lib/supabase-service";
import type { FollowingInsert, FollowingUpdate } from "@/lib/types/following";

export async function experienceCreateFollowing(experienceId: string, body: FollowingInsert) {
	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();
	const r = await createFollowingForUser(supabase, internalUserId, body);
	if (!r.ok) {
		throw new Error(r.error);
	}
	revalidatePath(`/experiences/${experienceId}/following`);
	return { id: r.id };
}

export async function experienceUpdateFollowing(experienceId: string, followingId: string, body: FollowingUpdate) {
	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();
	const r = await updateFollowingForUser(supabase, internalUserId, followingId, body);
	if (!r.ok) {
		throw new Error(r.error);
	}
	revalidatePath(`/experiences/${experienceId}/following`);
}

export async function experienceDeleteFollowing(experienceId: string, followingId: string) {
	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();
	const r = await deleteFollowingForUser(supabase, internalUserId, followingId);
	if (!r.ok) {
		throw new Error(r.error);
	}
	revalidatePath(`/experiences/${experienceId}/following`);
}
