import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { getSpendableCredits } from "@/lib/shotstack-ledger";

/**
 * GET /api/ghl/page-context?locationId=...
 * GET /api/ghl/page-context?userId=...
 *
 * Returns all user data for the GHL Custom Page settings view.
 * Looks up the user via ghl_locations → user_id, or directly by userId.
 */
export async function GET(request: NextRequest) {
	const locationId = request.nextUrl.searchParams.get("locationId");
	const directUserId = request.nextUrl.searchParams.get("userId");

	if (!locationId && !directUserId) {
		return Response.json({ error: "locationId or userId is required" }, { status: 400 });
	}

	const supabase = getServiceSupabase();

	let userId: string;
	let locationName: string | null = null;

	if (directUserId) {
		userId = directUserId;
	} else {
		// Find linked location
		const { data: loc } = await supabase
			.from("ghl_locations")
			.select("id, user_id, location_name, is_active")
			.eq("location_id", locationId!)
			.eq("is_active", true)
			.neq("access_token", "pending")
			.limit(1)
			.maybeSingle();

		if (!loc || !loc.user_id) {
			return Response.json({
				whopLinked: false,
				locationId,
				locationName: null,
			});
		}

		userId = loc.user_id;
		locationName = loc.location_name;
	}

	// Load all data in parallel
	const [userRes, workflowsRes, templatesRes, uploadPostCountRes, spendableCredits] =
		await Promise.all([
			supabase
				.from("users")
				.select(
					"id, name, email, has_upgraded, max_upload_post_accounts, max_storage_bytes, shotstack_api_key_encrypted",
				)
				.eq("id", userId)
				.single(),
			supabase
				.from("workflows")
				.select("id, name, version, private, published, archived, created_at")
				.eq("created_by", userId)
				.eq("archived", false)
				.order("created_at", { ascending: false })
				.limit(50),
			supabase
				.from("shotstack_templates")
				.select("id, name, default_env, created_at, updated_at")
				.eq("user_id", userId)
				.order("updated_at", { ascending: false }),
			supabase
				.from("upload_post_accounts")
				.select("id", { count: "exact", head: true })
				.eq("user_id", userId),
			getSpendableCredits(supabase, userId),
		]);

	const user = userRes.data;
	if (!user) {
		return Response.json({
			whopLinked: false,
			locationId: locationId ?? null,
			locationName,
		});
	}

	return Response.json({
		whopLinked: true,
		locationId: locationId ?? null,
		locationName,
		user: {
			name: user.name,
			email: user.email,
			hasUpgraded: !!user.has_upgraded,
			maxUploadPostAccounts: user.max_upload_post_accounts ?? 0,
			maxStorageBytes: user.max_storage_bytes ?? 0,
			hasByok: !!user.shotstack_api_key_encrypted?.trim(),
		},
		workflows: workflowsRes.data ?? [],
		templates: templatesRes.data ?? [],
		shotstack: {
			spendableCredits: spendableCredits,
			hasByok: !!user.shotstack_api_key_encrypted?.trim(),
		},
		uploadPostAccounts: uploadPostCountRes.count ?? 0,
	});
}
