"use client";

import { useCallback, useState } from "react";

type GhlLocation = {
	id: string;
	name: string;
	companyId: string;
	activated: boolean;
	hasRealToken: boolean;
};

type ConnectionInfo = {
	id: string;
	companyId: string;
	userType: string;
	hasRealToken: boolean;
};

/**
 * Two-phase button:
 * 1. If the user already has a Company-level connection, clicking the button
 *    fetches available locations and shows a picker to activate them.
 * 2. If there's no connection at all, it opens HighLevel's OAuth flow so
 *    the user can install the app and authorize.
 */
export function GhlConnectButton({ userId }: { userId: string }) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [connections, setConnections] = useState<ConnectionInfo[] | null>(
		null,
	);
	const [locations, setLocations] = useState<GhlLocation[]>([]);
	const [activating, setActivating] = useState<Set<string>>(new Set());

	const fetchLocations = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(
				`/api/ghl/locations/list?userId=${encodeURIComponent(userId)}`,
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as {
				connections: ConnectionInfo[];
				locations: GhlLocation[];
			};

			if (data.connections.length === 0) {
				window.open(
					`/api/ghl/auth/start?userId=${encodeURIComponent(userId)}`,
					"_blank",
				);
				setLoading(false);
				return;
			}

			setConnections(data.connections);
			setLocations(data.locations);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load");
		} finally {
			setLoading(false);
		}
	}, [userId]);

	const activateLocation = useCallback(
		async (loc: GhlLocation) => {
			const conn = connections?.find(
				(c) => c.companyId === loc.companyId,
			);
			if (!conn) return;

			setActivating((prev) => new Set(prev).add(loc.id));
			setError(null);
			try {
				const res = await fetch("/api/ghl/locations/activate", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						userId,
						locationId: loc.id,
						connectionId: conn.id,
					}),
				});
				if (!res.ok) {
					const data = (await res.json()) as { error?: string };
					throw new Error(data.error ?? `HTTP ${res.status}`);
				}
				setLocations((prev) =>
					prev.map((l) =>
						l.id === loc.id
							? { ...l, activated: true, hasRealToken: true }
							: l,
					),
				);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Activation failed",
				);
			} finally {
				setActivating((prev) => {
					const next = new Set(prev);
					next.delete(loc.id);
					return next;
				});
			}
		},
		[userId, connections],
	);

	if (!connections) {
		return (
			<div className="flex flex-col items-end gap-1">
				<button
					type="button"
					onClick={fetchLocations}
					disabled={loading}
					className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90 shrink-0 disabled:opacity-50"
				>
					{loading ? "Loading…" : "Connect GoHighLevel"}
				</button>
				{error && (
					<p className="text-2 text-red-9">{error}</p>
				)}
			</div>
		);
	}

	return (
		<div className="w-full mt-4 border border-gray-a4 rounded-lg p-4 bg-gray-a1">
			<div className="flex items-center justify-between mb-3">
				<h4 className="text-4 font-semibold text-gray-12">
					Select Sub-Accounts
				</h4>
				<button
					type="button"
					onClick={() => {
						setConnections(null);
						setLocations([]);
					}}
					className="text-2 text-gray-10 hover:text-gray-12"
				>
					Close
				</button>
			</div>

			{locations.length === 0 ? (
				<p className="text-3 text-gray-10">
					No sub-accounts found. Make sure the Extensible Content app
					is installed on at least one sub-account in HighLevel.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{locations.map((loc) => (
						<li
							key={loc.id}
							className="flex items-center justify-between gap-3 border border-gray-a4 rounded-md px-3 py-2 bg-gray-a2"
						>
							<div className="flex items-center gap-2 min-w-0">
								<span
									className={`w-2 h-2 rounded-full shrink-0 ${
										loc.hasRealToken
											? "bg-green-9"
											: loc.activated
												? "bg-yellow-9"
												: "bg-gray-8"
									}`}
								/>
								<div className="min-w-0">
									<p className="text-3 text-gray-12 truncate">
										{loc.name}
									</p>
									<p className="text-2 text-gray-10 font-mono truncate">
										{loc.id}
									</p>
								</div>
							</div>

							{loc.hasRealToken ? (
								<span className="text-2 text-green-9 font-medium shrink-0">
									Connected
								</span>
							) : (
								<button
									type="button"
									onClick={() => activateLocation(loc)}
									disabled={activating.has(loc.id)}
									className="text-2 px-3 py-1 rounded bg-blue-9 text-white hover:bg-blue-10 disabled:opacity-50 shrink-0"
								>
									{activating.has(loc.id)
										? "Activating…"
										: "Activate"}
								</button>
							)}
						</li>
					))}
				</ul>
			)}

			{error && (
				<p className="text-2 text-red-9 mt-2">{error}</p>
			)}

			<p className="text-2 text-gray-9 mt-3">
				Don&apos;t see your sub-account? Make sure the app is installed
				on it from the HighLevel Marketplace.
			</p>
		</div>
	);
}
