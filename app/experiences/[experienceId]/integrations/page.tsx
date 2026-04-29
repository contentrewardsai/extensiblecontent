import { requireExperienceContext } from "@/lib/experience-context";
import { getServiceSupabase } from "@/lib/supabase-service";
import { GhlConnectButton } from "./ghl-connect-button";

export default async function IntegrationsPage({
	params,
}: {
	params: Promise<{ experienceId: string }>;
}) {
	const { experienceId } = await params;
	const { internalUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	// Load GHL connections this user has access to (many-to-many join table).
	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("connection_id")
		.eq("user_id", internalUserId);

	const connIds = (access ?? []).map((a) => a.connection_id);

	let connections: Array<{
		id: string;
		company_id: string;
		user_type: string;
		created_at: string;
	}> = [];

	if (connIds.length > 0) {
		const { data: conns } = await supabase
			.from("ghl_connections")
			.select("id, company_id, user_type, created_at")
			.in("id", connIds)
			.order("created_at", { ascending: false });
		connections = conns ?? [];
	}

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

	const hasConnections = connections.length > 0;
	const activeLocations = locations.filter((l) => l.is_active);

	// Count of other Whop users sharing access to each connection.
	let shareCounts = new Map<string, number>();
	if (connIds.length > 0) {
		const { data: sharedRows } = await supabase
			.from("ghl_connection_users")
			.select("connection_id")
			.in("connection_id", connIds);
		shareCounts = (sharedRows ?? []).reduce((acc, row) => {
			acc.set(row.connection_id, (acc.get(row.connection_id) ?? 0) + 1);
			return acc;
		}, new Map<string, number>());
	}

	// Group active locations by connection for rendering.
	const locationsByConn = new Map<string, typeof activeLocations>();
	for (const loc of activeLocations) {
		const arr = locationsByConn.get(loc.connection_id) ?? [];
		arr.push(loc);
		locationsByConn.set(loc.connection_id, arr);
	}

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

				{hasConnections ? (
					<div className="mt-4 flex flex-col gap-4">
						<p className="text-3 text-gray-11">
							<strong className="text-gray-12">{connections.length}</strong>{" "}
							GHL {connections.length === 1 ? "account" : "accounts"} &middot;{" "}
							<strong className="text-gray-12">{activeLocations.length}</strong>{" "}
							active sub-account{activeLocations.length !== 1 ? "s" : ""}
						</p>

						{connections.map((conn) => {
							const locs = locationsByConn.get(conn.id) ?? [];
							const others = (shareCounts.get(conn.id) ?? 1) - 1;
							return (
								<div
									key={conn.id}
									className="border border-gray-a4 rounded-md p-3 bg-gray-a1"
								>
									<div className="flex items-center justify-between gap-2 flex-wrap mb-2">
										<div className="flex items-center gap-2">
											<span className="font-mono text-2 text-gray-11">
												{conn.company_id}
											</span>
											<span className="text-1 text-gray-10 border border-gray-a5 rounded px-2 py-px">
												{conn.user_type === "Company" ? "Agency" : "Location"}
											</span>
										</div>
										{others > 0 && (
											<span className="text-2 text-gray-10">
												Shared with {others} other Whop user{others === 1 ? "" : "s"}
											</span>
										)}
									</div>

									{locs.length === 0 ? (
										<p className="text-2 text-gray-10 italic">
											No active sub-accounts yet.
										</p>
									) : (
										<ul className="flex flex-col gap-2">
											{locs.map((loc) => (
												<li
													key={loc.id}
													className="flex items-center gap-2 border border-gray-a4 rounded-md px-3 py-2 bg-gray-a2"
												>
													<span className="w-2 h-2 rounded-full bg-green-9 shrink-0" />
													<span className="text-3 text-gray-12">
														{loc.location_name || loc.location_id}
													</span>
													<span className="text-2 text-gray-10 ml-auto font-mono">
														{loc.location_id}
													</span>
												</li>
											))}
										</ul>
									)}
								</div>
							);
						})}
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
