import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET /api/extension/publish-targets
 *
 * Returns a unified list of places the current user can publish to:
 *   - Upload-Post profiles (existing flow)
 *   - GHL sub-accounts (ghl_locations) plus the social channels cached
 *     in ghl_social_accounts for each
 *
 * Designed to back a single "Where do you want to post?" picker in the
 * extension and Whop app.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();

	const [uploadPostRes, ghlAccessRes] = await Promise.all([
		supabase
			.from("upload_post_accounts")
			.select("id, name, upload_post_username, jwt_access_url, created_at")
			.eq("user_id", user.user_id)
			.order("created_at", { ascending: false }),
		supabase
			.from("ghl_connection_users")
			.select("connection_id")
			.eq("user_id", user.user_id),
	]);

	const uploadPost = (uploadPostRes.data ?? []).map((a) => ({
		kind: "upload_post" as const,
		id: a.id,
		name: a.name,
		username: a.upload_post_username,
		access_url: a.jwt_access_url ?? null,
	}));

	const connIds = (ghlAccessRes.data ?? []).map((r) => r.connection_id);

	let ghlTargets: Array<{
		kind: "ghl";
		connection_id: string;
		company_id: string;
		location_id: string;
		ghl_location_id: string;
		location_name: string | null;
		channels: Array<{
			id: string;
			platform: string;
			display_name: string;
			account_type: string | null;
		}>;
	}> = [];

	if (connIds.length > 0) {
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
			.neq("access_token", "pending-link");

		const locs = locations ?? [];
		const locIds = locs.map((l) => l.id);

		let channelsByLoc = new Map<
			string,
			Array<{
				id: string;
				platform: string;
				display_name: string;
				account_type: string | null;
			}>
		>();

		if (locIds.length > 0) {
			const { data: channels } = await supabase
				.from("ghl_social_accounts")
				.select(
					"id, ghl_location_id, ghl_account_id, platform, display_name, account_type",
				)
				.in("ghl_location_id", locIds);

			channelsByLoc = (channels ?? []).reduce((acc, ch) => {
				const arr = acc.get(ch.ghl_location_id) ?? [];
				arr.push({
					id: ch.ghl_account_id,
					platform: ch.platform,
					display_name: ch.display_name,
					account_type: ch.account_type ?? null,
				});
				acc.set(ch.ghl_location_id, arr);
				return acc;
			}, new Map<string, typeof ghlTargets[number]["channels"]>());
		}

		ghlTargets = locs.map((l) => ({
			kind: "ghl" as const,
			connection_id: l.connection_id,
			company_id: companyByConn.get(l.connection_id) ?? "",
			location_id: l.location_id,
			ghl_location_id: l.id,
			location_name: l.location_name ?? null,
			channels: channelsByLoc.get(l.id) ?? [],
		}));
	}

	return Response.json({
		upload_post: uploadPost,
		ghl: ghlTargets,
	});
}
