import { requireExperienceContext } from "@/lib/experience-context";
import { getServiceSupabase } from "@/lib/supabase-service";
import { GhlConnectButton } from "./ghl-connect-button";
import { GhlConnectionKey } from "./ghl-connection-key";
import { getActiveKeyInfo } from "./generate-key-action";

export default async function IntegrationsPage({
	params,
}: {
	params: Promise<{ experienceId: string }>;
}) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	// Load GHL connections and locations for this user
	const { data: connections } = await supabase
		.from("ghl_connections")
		.select("id, company_id, user_type, created_at")
		.eq("user_id", internalUserId)
		.order("created_at", { ascending: false });

	const connIds = (connections ?? []).map((c) => c.id);

	let locations: Array<{
		id: string;
		connection_id: string;
		location_id: string;
		location_name: string | null;
		is_active: boolean;
	}> = [];

	if (connIds.length > 0) {
		const { data: locs } = await supabase
			.from("ghl_locations")
			.select("id, connection_id, location_id, location_name, is_active")
			.in("connection_id", connIds)
			.neq("access_token", "pending")
			.neq("access_token", "pending-link")
			.order("created_at", { ascending: false });
		locations = locs ?? [];
	}

	const hasConnections = (connections?.length ?? 0) > 0;
	const activeLocations = locations.filter((l) => l.is_active);
	const activeKeyInfo = await getActiveKeyInfo(internalUserId);

	return (
		<div className="flex flex-col gap-8">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Integrations</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Connect external platforms to use their media libraries and social accounts from Extensible Content.
				</p>
			</div>

			{/* GoHighLevel */}
			<section className="border border-gray-a4 rounded-lg p-5 bg-gray-a2">
				<div className="flex items-start justify-between gap-4 flex-wrap">
					<div>
						<h3 className="text-5 font-semibold text-gray-12">GoHighLevel</h3>
						<p className="text-3 text-gray-10 mt-1">
							Access your GHL media library and post to social channels connected in GoHighLevel.
						</p>
					</div>
					<GhlConnectButton userId={internalUserId} />
				</div>

				<GhlConnectionKey
					userId={internalUserId}
					existingKeyPrefix={activeKeyInfo?.prefix ?? null}
					existingKeyUsedAt={activeKeyInfo?.used_at ?? null}
				/>

				{hasConnections ? (
					<div className="mt-4">
						<p className="text-3 text-gray-11 mb-2">
							<strong className="text-gray-12">{activeLocations.length}</strong> active sub-account{activeLocations.length !== 1 ? "s" : ""} connected
						</p>

						{activeLocations.length > 0 && (
							<ul className="flex flex-col gap-2">
								{activeLocations.map((loc) => (
									<li
										key={loc.id}
										className="flex items-center gap-2 border border-gray-a4 rounded-md px-3 py-2 bg-gray-a1"
									>
										<span className="w-2 h-2 rounded-full bg-green-9 shrink-0" />
										<span className="text-3 text-gray-12">
											{loc.location_name || loc.location_id}
										</span>
										<span className="text-2 text-gray-10 ml-auto">{loc.location_id}</span>
									</li>
								))}
							</ul>
						)}
					</div>
				) : (
					<p className="text-3 text-gray-10 mt-3 border border-gray-a4 rounded-lg p-4 bg-gray-a1">
						No GoHighLevel accounts connected yet. Click &quot;Connect GoHighLevel&quot; to get started.
					</p>
				)}
			</section>
		</div>
	);
}
