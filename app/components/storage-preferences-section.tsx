"use client";

import { useCallback, useEffect, useState } from "react";

type Preference = "auto" | "ghl" | "supabase";

interface Prefs {
	preferred_storage: Preference;
	preferred_ghl_location_id: string | null;
	linked_ghl_locations: Array<{ locationId: string; name: string | null; companyId: string | null }>;
	has_ghl_connection: boolean;
}

/**
 * Surface-agnostic card for picking where uploads go. Used on both
 * `/experiences/[id]/shotstack` and `/ext/settings`.
 *
 * The caller supplies the API endpoint (relative) — typically
 * `/api/whop/storage-preferences?experienceId=...` or
 * `/api/ghl/storage-preferences?locationId=...&companyId=...`.
 */
export function StoragePreferencesSection({
	apiUrl,
	/** Optional title override; defaults to "Storage destination". */
	title = "Storage destination",
}: {
	apiUrl: string;
	title?: string;
}) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [prefs, setPrefs] = useState<Prefs | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(apiUrl, { credentials: "include" });
			if (!res.ok) throw new Error(`Load failed (${res.status})`);
			setPrefs((await res.json()) as Prefs);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load preferences");
		} finally {
			setLoading(false);
		}
	}, [apiUrl]);

	useEffect(() => {
		void load();
	}, [load]);

	const save = useCallback(
		async (patch: Partial<Pick<Prefs, "preferred_storage" | "preferred_ghl_location_id">>) => {
			setSaving(true);
			setError(null);
			try {
				const res = await fetch(apiUrl, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify(patch),
				});
				const j = (await res.json().catch(() => ({}))) as Prefs & { error?: string };
				if (!res.ok) throw new Error(j.error || `Save failed (${res.status})`);
				setPrefs(j);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to save preferences");
			} finally {
				setSaving(false);
			}
		},
		[apiUrl],
	);

	const describeEffective = (p: Prefs): string => {
		if (p.preferred_storage === "supabase") return "Content Rewards AI (Supabase) storage";
		if (p.preferred_storage === "ghl") {
			if (!p.has_ghl_connection) {
				return "HighLevel Media Library (but no connection yet — uploads will fall back to CRAI storage)";
			}
			if (p.linked_ghl_locations.length === 0) return "HighLevel — no location available, falls back to CRAI";
			return "HighLevel Media Library";
		}
		// auto
		if (!p.has_ghl_connection) return "Content Rewards AI (Supabase) — no HighLevel connection";
		if (p.linked_ghl_locations.length === 0) return "Content Rewards AI (no resolvable HighLevel location)";
		return "HighLevel Media Library (auto — GHL when linked)";
	};

	return (
		<section
			style={{
				border: "1px solid rgba(0,0,0,0.1)",
				borderRadius: 8,
				padding: 16,
				background: "rgba(0,0,0,0.02)",
				display: "flex",
				flexDirection: "column",
				gap: 12,
			}}
		>
			<div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
				<h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
				<span style={{ fontSize: 12, color: "#666" }}>Applies to renders, thumbnails, and other uploads.</span>
			</div>

			{loading ? (
				<p style={{ margin: 0, fontSize: 13, color: "#666" }}>Loading preferences…</p>
			) : !prefs ? (
				<p style={{ margin: 0, fontSize: 13, color: "#b00020" }}>{error ?? "Could not load preferences."}</p>
			) : (
				<>
					<label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
						<span style={{ color: "#333" }}>Default destination</span>
						<select
							value={prefs.preferred_storage}
							disabled={saving}
							onChange={(e) => void save({ preferred_storage: e.target.value as Preference })}
							style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.15)", fontSize: 13 }}
						>
							<option value="auto">
								Auto — HighLevel when a location is connected, otherwise CRAI (recommended)
							</option>
							<option value="ghl">HighLevel Media Library (fall back to CRAI if unreachable)</option>
							<option value="supabase">Content Rewards AI (Supabase) storage</option>
						</select>
					</label>

					{prefs.linked_ghl_locations.length > 0 ? (
						<label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
							<span style={{ color: "#333" }}>Default HighLevel location</span>
							<select
								value={prefs.preferred_ghl_location_id ?? ""}
								disabled={saving}
								onChange={(e) =>
									void save({ preferred_ghl_location_id: e.target.value === "" ? null : e.target.value })
								}
								style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.15)", fontSize: 13 }}
							>
								<option value="">
									{prefs.linked_ghl_locations.length === 1 ? "Use the only linked location" : "Let the app auto-pick"}
								</option>
								{prefs.linked_ghl_locations.map((l) => (
									<option key={l.locationId} value={l.locationId}>
										{l.name || l.locationId}
									</option>
								))}
							</select>
							<span style={{ fontSize: 12, color: "#666" }}>
								Used when you upload from Whop (outside a HighLevel Custom Page). Inside HighLevel, uploads always go
								to the active location.
							</span>
						</label>
					) : (
						<p style={{ margin: 0, fontSize: 12, color: "#666" }}>
							No HighLevel locations linked yet. Connect HighLevel to enable Media Library uploads.
						</p>
					)}

					<p style={{ margin: 0, fontSize: 12, color: "#333" }}>
						<strong>Right now, uploads go to:</strong> {describeEffective(prefs)}
					</p>

					{error ? <p style={{ margin: 0, fontSize: 12, color: "#b00020" }}>{error}</p> : null}
					{saving ? <p style={{ margin: 0, fontSize: 12, color: "#666" }}>Saving…</p> : null}
				</>
			)}
		</section>
	);
}
