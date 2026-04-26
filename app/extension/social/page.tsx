"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Channel {
	id: string;
	platform: string;
	display_name: string;
}

interface GhlTarget {
	kind: "ghl";
	connection_id: string;
	company_id: string;
	location_id: string;
	ghl_location_id: string;
	location_name: string | null;
	channels: Channel[];
}

interface UploadPostTarget {
	kind: "upload_post";
	id: string;
	name: string;
	username: string;
}

interface PublishTargets {
	upload_post: UploadPostTarget[];
	ghl: GhlTarget[];
}

interface ScheduledPost {
	id: string;
	location_id: string;
	payload: {
		summary?: string;
		accountIds?: string[];
	} | null;
	scheduled_for: string;
	status: string;
	attempts: number;
	last_error: string | null;
	ghl_post_id: string | null;
	created_at: string;
}

function requestToken(): Promise<string | null> {
	return new Promise((resolve) => {
		if (typeof window === "undefined") {
			resolve(null);
			return;
		}
		const requestId = Math.random().toString(36).slice(2);
		const timer = setTimeout(() => {
			window.removeEventListener("message", listener);
			resolve(null);
		}, 1500);

		function listener(event: MessageEvent) {
			if (event.source !== window) return;
			const data = event.data;
			if (!data || data.type !== "EC_TOKEN" || data.requestId !== requestId)
				return;
			clearTimeout(timer);
			window.removeEventListener("message", listener);
			resolve(typeof data.token === "string" ? data.token : null);
		}
		window.addEventListener("message", listener);
		window.postMessage({ type: "EC_GET_TOKEN", requestId }, "*");
	});
}

async function apiFetch<T>(
	path: string,
	token: string,
	init?: RequestInit,
): Promise<T> {
	const headers = new Headers(init?.headers ?? {});
	headers.set("Authorization", `Bearer ${token}`);
	if (init?.body && !headers.has("Content-Type"))
		headers.set("Content-Type", "application/json");

	const res = await fetch(path, { ...init, headers });
	const text = await res.text();
	const json = text ? (JSON.parse(text) as unknown) : null;
	if (!res.ok) {
		const msg =
			(json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
		throw new Error(msg);
	}
	return json as T;
}

export default function ExtensionSocialPage() {
	const [token, setToken] = useState<string | null>(null);
	const [authReady, setAuthReady] = useState(false);

	const [targets, setTargets] = useState<PublishTargets | null>(null);
	const [loadingTargets, setLoadingTargets] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [selectedLocation, setSelectedLocation] = useState<string>("");
	const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
		new Set(),
	);
	const [summary, setSummary] = useState("");
	const [media, setMedia] = useState("");
	const [scheduledFor, setScheduledFor] = useState("");

	const [submitting, setSubmitting] = useState(false);
	const [status, setStatus] = useState<{
		ok: boolean;
		msg: string;
	} | null>(null);

	const [scheduled, setScheduled] = useState<ScheduledPost[]>([]);
	const [loadingScheduled, setLoadingScheduled] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const t = await requestToken();
			if (cancelled) return;
			setToken(t);
			setAuthReady(true);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const loadTargets = useCallback(
		async (t: string) => {
			setLoadingTargets(true);
			setLoadError(null);
			try {
				const data = await apiFetch<PublishTargets>(
					"/api/extension/publish-targets",
					t,
				);
				setTargets(data);
				if (!selectedLocation && data.ghl[0]) {
					setSelectedLocation(data.ghl[0].location_id);
				}
			} catch (err) {
				setLoadError(err instanceof Error ? err.message : "Failed to load");
			} finally {
				setLoadingTargets(false);
			}
		},
		[selectedLocation],
	);

	const loadScheduled = useCallback(async (t: string) => {
		setLoadingScheduled(true);
		try {
			const data = await apiFetch<{ posts: ScheduledPost[] }>(
				"/api/extension/ghl/social/schedule",
				t,
			);
			setScheduled(data.posts ?? []);
		} catch {
			// non-fatal
		} finally {
			setLoadingScheduled(false);
		}
	}, []);

	useEffect(() => {
		if (!token) return;
		// Fire-and-forget: kick the scheduler so any due posts publish now
		// (Vercel Hobby runs crons only once per day).
		fetch("/api/ghl/kick-scheduler", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		})
			.catch(() => null)
			.finally(() => {
				loadTargets(token);
				loadScheduled(token);
			});
	}, [token, loadTargets, loadScheduled]);

	const activeTarget = useMemo(
		() => targets?.ghl.find((g) => g.location_id === selectedLocation) ?? null,
		[targets, selectedLocation],
	);

	const toggleChannel = (id: string) => {
		setSelectedChannels((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const mediaList = useMemo(
		() =>
			media
				.split(/\s+/)
				.map((s) => s.trim())
				.filter((s) => /^https?:\/\//i.test(s))
				.map((url) => ({ url })),
		[media],
	);

	const canSubmit =
		!!token &&
		!!selectedLocation &&
		summary.trim().length > 0 &&
		selectedChannels.size > 0 &&
		!submitting;

	const buildPayload = () => ({
		accountIds: Array.from(selectedChannels),
		summary,
		type: "post" as const,
		locationId: selectedLocation,
		...(mediaList.length > 0 ? { media: mediaList } : {}),
	});

	const handlePostNow = async () => {
		if (!token || !canSubmit) return;
		setSubmitting(true);
		setStatus(null);
		try {
			await apiFetch("/api/extension/ghl/social/posts", token, {
				method: "POST",
				body: JSON.stringify(buildPayload()),
			});
			setStatus({ ok: true, msg: "Posted to GHL." });
			setSummary("");
			setMedia("");
			await loadScheduled(token);
		} catch (err) {
			setStatus({
				ok: false,
				msg: err instanceof Error ? err.message : "Failed",
			});
		} finally {
			setSubmitting(false);
		}
	};

	const handleSchedule = async () => {
		if (!token || !canSubmit || !scheduledFor) return;
		setSubmitting(true);
		setStatus(null);
		try {
			const when = new Date(scheduledFor);
			if (Number.isNaN(when.getTime())) throw new Error("Invalid date");
			await apiFetch("/api/extension/ghl/social/schedule", token, {
				method: "POST",
				body: JSON.stringify({
					locationId: selectedLocation,
					scheduledFor: when.toISOString(),
					payload: buildPayload(),
					source: "extension",
				}),
			});
			setStatus({
				ok: true,
				msg: `Scheduled for ${when.toLocaleString()}.`,
			});
			setSummary("");
			setMedia("");
			setScheduledFor("");
			await loadScheduled(token);
		} catch (err) {
			setStatus({
				ok: false,
				msg: err instanceof Error ? err.message : "Failed",
			});
		} finally {
			setSubmitting(false);
		}
	};

	const handleCancel = async (id: string) => {
		if (!token) return;
		try {
			await apiFetch(
				`/api/extension/ghl/social/schedule?id=${encodeURIComponent(id)}`,
				token,
				{ method: "DELETE" },
			);
			await loadScheduled(token);
		} catch (err) {
			setStatus({
				ok: false,
				msg: err instanceof Error ? err.message : "Failed",
			});
		}
	};

	if (!authReady) {
		return (
			<div style={styles.page}>
				<p style={styles.muted}>Connecting to extension…</p>
			</div>
		);
	}

	if (!token) {
		return (
			<div style={styles.page}>
				<div style={styles.card}>
					<h1 style={styles.title}>Extensible Content — Social</h1>
					<p style={styles.muted}>
						You&apos;re not signed in to the Chrome extension yet. Open the
						popup and click <strong>Login with Whop</strong>, then reload this
						page.
					</p>
					<a href="/extension/login" style={styles.primaryBtn}>
						Sign in
					</a>
				</div>
			</div>
		);
	}

	return (
		<div style={styles.page}>
			<div style={styles.header}>
				<h1 style={styles.title}>Post to GoHighLevel</h1>
				<p style={styles.muted}>
					Publish now, or queue a scheduled post. Our backend fires scheduled
					posts even if your browser is closed.
				</p>
			</div>

			{loadError && <div style={styles.errorBanner}>{loadError}</div>}

			<div style={styles.card}>
				<h2 style={styles.sectionTitle}>Compose</h2>

				{loadingTargets && !targets ? (
					<p style={styles.muted}>Loading your GHL sub-accounts…</p>
				) : !targets || targets.ghl.length === 0 ? (
					<p style={styles.muted}>
						No GoHighLevel sub-accounts yet. Connect one from the Whop{" "}
						<a href="/" style={styles.link}>
							Integrations page
						</a>
						, or install the GHL app, then reload.
					</p>
				) : (
					<>
						<label style={styles.label}>GHL sub-account</label>
						<select
							value={selectedLocation}
							onChange={(e) => {
								setSelectedLocation(e.target.value);
								setSelectedChannels(new Set());
							}}
							style={styles.input}
						>
							{targets.ghl.map((g) => (
								<option key={g.location_id} value={g.location_id}>
									{g.location_name ?? g.location_id} — {g.company_id}
								</option>
							))}
						</select>

						<label style={{ ...styles.label, marginTop: 16 }}>
							Social channels
						</label>
						{activeTarget && activeTarget.channels.length === 0 ? (
							<p style={styles.muted}>
								No social channels cached for this location yet. Open the GHL
								Social Planner once so we can cache them, then reload.
							</p>
						) : (
							<div style={styles.chipRow}>
								{activeTarget?.channels.map((ch) => {
									const active = selectedChannels.has(ch.id);
									return (
										<button
											type="button"
											key={ch.id}
											onClick={() => toggleChannel(ch.id)}
											style={{
												...styles.chip,
												...(active ? styles.chipActive : {}),
											}}
										>
											<span style={styles.chipPlatform}>{ch.platform}</span>
											{ch.display_name}
										</button>
									);
								})}
							</div>
						)}

						<label style={{ ...styles.label, marginTop: 16 }}>Post text</label>
						<textarea
							value={summary}
							onChange={(e) => setSummary(e.target.value)}
							rows={4}
							placeholder="What do you want to publish?"
							style={{ ...styles.input, resize: "vertical" }}
						/>

						<label style={{ ...styles.label, marginTop: 16 }}>
							Media URLs{" "}
							<span style={styles.muted}>
								(one per line, https:// links)
							</span>
						</label>
						<textarea
							value={media}
							onChange={(e) => setMedia(e.target.value)}
							rows={2}
							placeholder="https://cdn.example.com/image.jpg"
							style={{
								...styles.input,
								fontFamily: "ui-monospace, monospace",
								resize: "vertical",
							}}
						/>

						<div style={styles.actions}>
							<button
								type="button"
								onClick={handlePostNow}
								disabled={!canSubmit}
								style={{
									...styles.primaryBtn,
									...(canSubmit ? {} : styles.btnDisabled),
								}}
							>
								{submitting ? "Posting…" : "Post now"}
							</button>

							<div style={styles.scheduleRow}>
								<input
									type="datetime-local"
									value={scheduledFor}
									onChange={(e) => setScheduledFor(e.target.value)}
									style={styles.input}
								/>
								<button
									type="button"
									onClick={handleSchedule}
									disabled={!canSubmit || !scheduledFor}
									style={{
										...styles.secondaryBtn,
										...(canSubmit && scheduledFor ? {} : styles.btnDisabled),
									}}
								>
									Schedule
								</button>
							</div>
						</div>

						{status && (
							<div
								style={status.ok ? styles.successBanner : styles.errorBanner}
							>
								{status.msg}
							</div>
						)}
					</>
				)}
			</div>

			<div style={styles.card}>
				<h2 style={styles.sectionTitle}>
					Scheduled &amp; recent
					{scheduled.length > 0 && (
						<span style={styles.countBadge}>{scheduled.length}</span>
					)}
				</h2>
				{loadingScheduled && scheduled.length === 0 ? (
					<p style={styles.muted}>Loading…</p>
				) : scheduled.length === 0 ? (
					<p style={styles.muted}>No posts yet.</p>
				) : (
					<ul style={styles.scheduledList}>
						{scheduled.map((p) => (
							<li key={p.id} style={styles.scheduledItem}>
								<div style={styles.scheduledHeader}>
									<span
										style={{
											...styles.statusPill,
											...(statusPillStyle(p.status) ?? {}),
										}}
									>
										{p.status.replace("_", " ")}
									</span>
									<span style={styles.body}>
										{new Date(p.scheduled_for).toLocaleString()}
									</span>
									<span style={styles.mono}>{p.location_id}</span>
									{p.status === "pending" && (
										<button
											type="button"
											onClick={() => handleCancel(p.id)}
											style={styles.linkDangerBtn}
										>
											Cancel
										</button>
									)}
								</div>
								{p.payload?.summary && (
									<p
										style={{
											...styles.body,
											marginTop: 6,
											whiteSpace: "pre-wrap",
										}}
									>
										{p.payload.summary}
									</p>
								)}
								{p.last_error && (
									<p style={{ ...styles.muted, color: "#82071e", marginTop: 4 }}>
										Error: {p.last_error}
									</p>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function statusPillStyle(status: string): React.CSSProperties | undefined {
	switch (status) {
		case "pending":
			return { background: "#eef2ff", color: "#4338ca" };
		case "in_progress":
			return { background: "#e0f2fe", color: "#075985" };
		case "succeeded":
			return { background: "#dafbe1", color: "#116329" };
		case "failed":
			return { background: "#ffebe9", color: "#82071e" };
		case "cancelled":
			return { background: "#eaeef2", color: "#57606a" };
		default:
			return undefined;
	}
}

const styles: Record<string, React.CSSProperties> = {
	page: {
		fontFamily: "system-ui, -apple-system, sans-serif",
		maxWidth: 780,
		margin: "0 auto",
		padding: "32px 20px",
		display: "flex",
		flexDirection: "column",
		gap: 20,
	},
	header: { display: "flex", flexDirection: "column", gap: 6 },
	title: { fontSize: 22, fontWeight: 700, color: "#111", margin: 0 },
	card: {
		border: "1px solid #e1e4e8",
		borderRadius: 10,
		padding: 20,
		background: "#fff",
		display: "flex",
		flexDirection: "column",
		gap: 10,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: 600,
		color: "#111",
		margin: "0 0 6px 0",
	},
	label: { fontSize: 13, color: "#57606a", fontWeight: 500 },
	input: {
		width: "100%",
		fontSize: 14,
		color: "#111",
		padding: "8px 10px",
		border: "1px solid #d0d7de",
		borderRadius: 6,
		background: "#fff",
		boxSizing: "border-box",
	},
	chipRow: { display: "flex", flexWrap: "wrap", gap: 8 },
	chip: {
		fontSize: 13,
		padding: "6px 10px",
		border: "1px solid #d0d7de",
		background: "#fff",
		color: "#57606a",
		borderRadius: 16,
		cursor: "pointer",
	},
	chipActive: {
		borderColor: "#111",
		background: "#f6f8fa",
		color: "#111",
	},
	chipPlatform: {
		fontSize: 10,
		textTransform: "uppercase",
		letterSpacing: 0.4,
		color: "#57606a",
		marginRight: 6,
	},
	actions: {
		display: "flex",
		flexWrap: "wrap",
		gap: 10,
		alignItems: "center",
		marginTop: 8,
	},
	scheduleRow: { display: "flex", gap: 8, alignItems: "center" },
	primaryBtn: {
		fontSize: 14,
		fontWeight: 500,
		padding: "8px 18px",
		borderRadius: 6,
		border: "none",
		background: "#111",
		color: "#fff",
		cursor: "pointer",
		textDecoration: "none",
		display: "inline-block",
	},
	secondaryBtn: {
		fontSize: 13,
		fontWeight: 500,
		padding: "7px 14px",
		borderRadius: 6,
		border: "1px solid #d0d7de",
		background: "#fff",
		color: "#111",
		cursor: "pointer",
	},
	btnDisabled: { opacity: 0.4, cursor: "not-allowed" },
	muted: { margin: 0, fontSize: 13, color: "#666" },
	body: { margin: 0, fontSize: 14, color: "#111" },
	mono: {
		fontSize: 12,
		color: "#57606a",
		fontFamily: "ui-monospace, monospace",
	},
	link: { color: "#0969da", textDecoration: "underline" },
	successBanner: {
		fontSize: 13,
		padding: "10px 14px",
		borderRadius: 8,
		background: "#dafbe1",
		color: "#116329",
		border: "1px solid #aceebb",
	},
	errorBanner: {
		fontSize: 13,
		padding: "10px 14px",
		borderRadius: 8,
		background: "#ffebe9",
		color: "#82071e",
		border: "1px solid #ff8182",
	},
	countBadge: {
		display: "inline-block",
		marginLeft: 8,
		fontSize: 12,
		fontWeight: 600,
		background: "#eef2ff",
		color: "#4338ca",
		padding: "1px 8px",
		borderRadius: 10,
	},
	scheduledList: {
		listStyle: "none",
		padding: 0,
		margin: 0,
		display: "flex",
		flexDirection: "column",
		gap: 10,
	},
	scheduledItem: {
		border: "1px solid #e1e4e8",
		borderRadius: 8,
		padding: "10px 12px",
		background: "#fafbfc",
	},
	scheduledHeader: {
		display: "flex",
		alignItems: "center",
		gap: 10,
		flexWrap: "wrap" as const,
	},
	statusPill: {
		fontSize: 11,
		fontWeight: 600,
		textTransform: "uppercase" as const,
		letterSpacing: 0.4,
		padding: "2px 8px",
		borderRadius: 10,
	},
	linkDangerBtn: {
		marginLeft: "auto",
		fontSize: 12,
		fontWeight: 500,
		background: "transparent",
		color: "#cf222e",
		border: "none",
		cursor: "pointer",
		padding: 0,
		textDecoration: "underline",
	},
};
