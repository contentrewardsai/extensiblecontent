import { requireExperienceContext } from "@/lib/experience-context";
import { processDueGhlPosts } from "@/lib/ghl-scheduler";
import { getServiceSupabase } from "@/lib/supabase-service";
import {
	ScheduledPostsList,
	SocialComposer,
	type ScheduledRow,
	type SocialTarget,
} from "./social-client";

async function loadTargets(internalUserId: string): Promise<SocialTarget[]> {
	const supabase = getServiceSupabase();

	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("connection_id")
		.eq("user_id", internalUserId);

	const connIds = (access ?? []).map((a) => a.connection_id);
	if (connIds.length === 0) return [];

	const { data: connections } = await supabase
		.from("ghl_connections")
		.select("id, company_id")
		.in("id", connIds);
	const companyByConn = new Map<string, string>();
	for (const c of connections ?? []) companyByConn.set(c.id, c.company_id);

	const { data: locations } = await supabase
		.from("ghl_locations")
		.select("id, connection_id, location_id, location_name, is_active")
		.in("connection_id", connIds)
		.eq("is_active", true)
		.neq("access_token", "pending")
		.neq("access_token", "pending-link")
		.order("location_name", { ascending: true });

	const locs = locations ?? [];
	if (locs.length === 0) return [];

	const locIds = locs.map((l) => l.id);
	const { data: channels } = await supabase
		.from("ghl_social_accounts")
		.select(
			"ghl_location_id, ghl_account_id, platform, display_name",
		)
		.in("ghl_location_id", locIds);

	const channelsByLoc = new Map<
		string,
		Array<{ id: string; platform: string; displayName: string }>
	>();
	for (const ch of channels ?? []) {
		const arr = channelsByLoc.get(ch.ghl_location_id) ?? [];
		arr.push({
			id: ch.ghl_account_id,
			platform: ch.platform,
			displayName: ch.display_name,
		});
		channelsByLoc.set(ch.ghl_location_id, arr);
	}

	return locs.map((l) => ({
		connectionId: l.connection_id,
		companyId: companyByConn.get(l.connection_id) ?? "",
		locationId: l.location_id,
		locationName: l.location_name ?? l.location_id,
		channels: channelsByLoc.get(l.id) ?? [],
	}));
}

async function loadScheduled(internalUserId: string): Promise<ScheduledRow[]> {
	const supabase = getServiceSupabase();
	const { data } = await supabase
		.from("ghl_scheduled_posts")
		.select(
			"id, location_id, payload, scheduled_for, status, attempts, last_error, ghl_post_id, created_at",
		)
		.eq("user_id", internalUserId)
		.order("scheduled_for", { ascending: false })
		.limit(50);

	return (data ?? []).map((r) => {
		const payload = (r.payload ?? {}) as {
			summary?: string;
			accountIds?: string[];
		};
		return {
			id: r.id,
			locationId: r.location_id,
			summary: payload.summary ?? "",
			accountIds: Array.isArray(payload.accountIds) ? payload.accountIds : [],
			scheduledFor: r.scheduled_for,
			status: r.status,
			attempts: r.attempts,
			lastError: r.last_error,
			ghlPostId: r.ghl_post_id,
			createdAt: r.created_at,
		};
	});
}

export default async function SocialPage({
	params,
}: {
	params: Promise<{ experienceId: string }>;
}) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);

	// Hobby-friendly: publish any posts that are already due for this user
	// before we render the list. Bounded at 5 rows so page load stays fast.
	await processDueGhlPosts({ userId: internalUserId, batchSize: 5 }).catch(
		() => null,
	);

	const [targets, scheduled] = await Promise.all([
		loadTargets(internalUserId),
		loadScheduled(internalUserId),
	]);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Social</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Post or schedule to any social channel connected through your
					GoHighLevel sub-accounts. Scheduled posts are published by our
					backend, so they go out even if nobody is online.
				</p>
			</div>

			<section>
				<h3 className="text-4 font-semibold text-gray-12 mb-2">Compose</h3>
				<SocialComposer experienceId={experienceId} targets={targets} />
			</section>

			<section>
				<h3 className="text-4 font-semibold text-gray-12 mb-2">
					Scheduled &amp; recent
				</h3>
				<ScheduledPostsList experienceId={experienceId} rows={scheduled} />
			</section>
		</div>
	);
}
