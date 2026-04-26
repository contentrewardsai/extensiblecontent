"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const WHOP_USER_STORAGE_KEY = "ec_whop_user_id";
const KNOWN_USERS_STORAGE_KEY = "ec_known_whop_users";

interface ConnectedUser {
	userId: string;
	name: string | null;
	email: string | null;
	linkedAt: string;
	isSelf: boolean;
}

interface KnownUser {
	userId: string;
	name: string | null;
	email: string | null;
	lastUsed: string;
}

interface ScheduledPost {
	id: string;
	payload: {
		summary?: string;
		accountIds?: string[];
	} | null;
	scheduled_for: string;
	status: string;
	attempts: number;
	last_error: string | null;
	ghl_post_id: string | null;
	source: string | null;
	created_at: string;
}

function readKnownUsers(): KnownUser[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(KNOWN_USERS_STORAGE_KEY);
		if (!raw) return [];
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? (arr as KnownUser[]) : [];
	} catch {
		return [];
	}
}

function rememberUser(u: {
	userId: string;
	name?: string | null;
	email?: string | null;
}) {
	if (typeof localStorage === "undefined") return;
	const existing = readKnownUsers().filter((x) => x.userId !== u.userId);
	const updated: KnownUser[] = [
		{
			userId: u.userId,
			name: u.name ?? null,
			email: u.email ?? null,
			lastUsed: new Date().toISOString(),
		},
		...existing,
	].slice(0, 8);
	try {
		localStorage.setItem(KNOWN_USERS_STORAGE_KEY, JSON.stringify(updated));
	} catch {
		/* quota, ignore */
	}
}

function forgetUser(userId: string) {
	if (typeof localStorage === "undefined") return;
	const updated = readKnownUsers().filter((x) => x.userId !== userId);
	try {
		localStorage.setItem(KNOWN_USERS_STORAGE_KEY, JSON.stringify(updated));
	} catch {
		/* ignore */
	}
}

interface PageContext {
	whopLinked: boolean;
	hasAnyLink?: boolean;
	locationId: string;
	locationName: string | null;
	companyId?: string;
	user?: {
		name: string | null;
		email: string;
		hasUpgraded: boolean;
		maxUploadPostAccounts: number;
		maxStorageBytes: number;
		hasByok: boolean;
	};
	workflows?: Array<{
		id: string;
		name: string;
		version: number;
		private: boolean;
		published: boolean;
		archived: boolean;
		created_at: string;
	}>;
	templates?: Array<{
		id: string;
		name: string;
		default_env: string;
		created_at: string;
		updated_at: string;
	}>;
	shotstack?: {
		spendableCredits: number;
		hasByok: boolean;
	};
	uploadPostAccounts?: number;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

/**
 * Request SSO payload from the GHL parent window via postMessage.
 * Returns decrypted user context with companyId, activeLocation, etc.
 */
function requestSsoContext(): Promise<{
	companyId: string;
	activeLocation?: string;
	/** The raw encrypted SSO payload, reusable as an auth header for other endpoints. */
	rawPayload: string;
}> {
	return new Promise((resolve, reject) => {
		let resolved = false;

		function listener(event: MessageEvent) {
			if (event.data?.message === "REQUEST_USER_DATA_RESPONSE" && !resolved) {
				resolved = true;
				clearInterval(retryInterval);
				clearTimeout(timeout);
				window.removeEventListener("message", listener);

				const rawPayload: string = event.data.payload;
				fetch("/api/ghl/sso", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ payload: rawPayload }),
				})
					.then((res) => {
						if (!res.ok) throw new Error("SSO decryption failed");
						return res.json();
					})
					.then((data) => resolve({ ...data, rawPayload }))
					.catch(reject);
			}
		}

		window.addEventListener("message", listener);

		const targets = [window.parent, window.top].filter(
			(w): w is Window => w !== null && w !== window,
		);
		function sendRequest() {
			for (const target of targets) {
				try {
					target.postMessage({ message: "REQUEST_USER_DATA" }, "*");
				} catch {
					/* cross-origin */
				}
			}
		}

		sendRequest();
		const retryInterval = setInterval(() => {
			if (!resolved) sendRequest();
		}, 1500);

		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				clearInterval(retryInterval);
				window.removeEventListener("message", listener);
				reject(new Error("SSO timed out"));
			}
		}, 10_000);
	});
}

export default function GhlSettingsPage() {
	const searchParams = useSearchParams();
	const connected = searchParams.get("connected");
	const errorParam = searchParams.get("error");

	const [ctx, setCtx] = useState<PageContext | null>(null);
	const [loading, setLoading] = useState(true);
	const [needsLink, setNeedsLink] = useState(false);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);

	// Connection Key fallback
	const [showKeyForm, setShowKeyForm] = useState(false);
	const [keyInput, setKeyInput] = useState("");
	const [keyLoading, setKeyLoading] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);

	// GHL identifiers from SSO
	const [ghlCompanyId, setGhlCompanyId] = useState<string | null>(null);
	const [ghlLocationId, setGhlLocationId] = useState<string | null>(null);
	// Raw encrypted SSO payload. We forward this as an auth header to
	// server-side endpoints that need to verify GHL-side access without
	// requiring a Whop user session (e.g. listing Whop accounts linked to the
	// current GHL subaccount in a fresh browser).
	const [ghlSsoPayload, setGhlSsoPayload] = useState<string | null>(null);

	// Active Whop user viewing this page (from sessionStorage or OAuth popup)
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);

	// Accounts the browser has already authenticated (for quick switching
	// without re-OAuth). Kept in localStorage.
	const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);

	// Scheduled posts for the current location + active Whop user.
	const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
	const [scheduledLoading, setScheduledLoading] = useState(false);
	const [scheduledError, setScheduledError] = useState<string | null>(null);
	const [cancellingId, setCancellingId] = useState<string | null>(null);

	useEffect(() => {
		setKnownUsers(readKnownUsers());
	}, []);

	const loadScheduledPosts = useCallback(
		async (userId: string, locationId: string) => {
			setScheduledLoading(true);
			setScheduledError(null);
			try {
				const qs = new URLSearchParams({ userId, locationId });
				const res = await fetch(`/api/ghl/scheduled-posts?${qs.toString()}`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as { posts?: ScheduledPost[] };
				setScheduledPosts(data.posts ?? []);
			} catch (err) {
				setScheduledError(
					err instanceof Error ? err.message : "Failed to load",
				);
			} finally {
				setScheduledLoading(false);
			}
		},
		[],
	);

	const cancelScheduledPost = useCallback(
		async (id: string, userId: string, locationId: string) => {
			setCancellingId(id);
			try {
				const qs = new URLSearchParams({ id, userId });
				const res = await fetch(`/api/ghl/scheduled-posts?${qs.toString()}`, {
					method: "DELETE",
				});
				if (!res.ok) {
					const data = (await res.json().catch(() => null)) as {
						error?: string;
					} | null;
					throw new Error(data?.error ?? `HTTP ${res.status}`);
				}
				await loadScheduledPosts(userId, locationId);
			} catch (err) {
				setScheduledError(
					err instanceof Error ? err.message : "Failed to cancel",
				);
			} finally {
				setCancellingId(null);
			}
		},
		[loadScheduledPosts],
	);

	useEffect(() => {
		if (!currentUserId || !ghlLocationId) {
			setScheduledPosts([]);
			return;
		}
		// Fire-and-forget kick: publish any due posts owned by this user
		// before we fetch the list (Vercel Hobby runs crons once per day).
		fetch(
			`/api/ghl/kick-scheduler?userId=${encodeURIComponent(currentUserId)}`,
			{ method: "POST" },
		)
			.catch(() => null)
			.finally(() => {
				loadScheduledPosts(currentUserId, ghlLocationId);
			});
	}, [currentUserId, ghlLocationId, loadScheduledPosts]);

	const loadPageContext = useCallback(
		async (params: {
			companyId?: string;
			locationId?: string;
			userId?: string;
		}) => {
			const qs = new URLSearchParams();
			if (params.companyId) qs.set("companyId", params.companyId);
			if (params.locationId) qs.set("locationId", params.locationId);
			if (params.userId) qs.set("userId", params.userId);

			const res = await fetch(`/api/ghl/page-context?${qs.toString()}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return (await res.json()) as PageContext;
		},
		[],
	);

	// Init: SSO → check sessionStorage for cached user → show settings or link prompt
	useEffect(() => {
		let cancelled = false;

		async function init() {
			setLoading(true);

			let companyId: string | null = null;
			let locationId: string | null = null;

			let rawSso: string | null = null;
			try {
				const sso = await requestSsoContext();
				companyId = sso.companyId || null;
				locationId = sso.activeLocation || null;
				rawSso = sso.rawPayload || null;
			} catch {
				// SSO not available
			}

			if (cancelled) return;

			if (companyId) setGhlCompanyId(companyId);
			if (locationId) setGhlLocationId(locationId);
			if (rawSso) setGhlSsoPayload(rawSso);

			// Check sessionStorage for a remembered Whop user in this browser tab.
			// Many-to-many: multiple Whop users may be linked to the same GHL
			// company, so the server can't auto-pick. The user picks once via
			// OAuth, and we remember their choice for the tab.
			const cachedUserId =
				typeof sessionStorage !== "undefined"
					? sessionStorage.getItem(WHOP_USER_STORAGE_KEY)
					: null;

			// If we have no context at all (SSO failed AND no cached user), skip
			// the API call entirely -- it would 400. Show the link prompt.
			if (!companyId && !locationId && !cachedUserId) {
				if (!cancelled) {
					setNeedsLink(true);
					setLoading(false);
				}
				return;
			}

			try {
				const data = await loadPageContext({
					companyId: companyId ?? undefined,
					locationId: locationId ?? undefined,
					userId: cachedUserId ?? undefined,
				});

				if (cancelled) return;

				if (data.whopLinked) {
					setCtx(data);
					if (cachedUserId) {
						setCurrentUserId(cachedUserId);
						if (data.user) {
							rememberUser({
								userId: cachedUserId,
								name: data.user.name,
								email: data.user.email,
							});
							setKnownUsers(readKnownUsers());
						}
					}
					setLoading(false);
					return;
				}

				// Cached user is no longer valid (revoked access, etc.) -- clear.
				if (cachedUserId) {
					sessionStorage.removeItem(WHOP_USER_STORAGE_KEY);
				}
			} catch (err) {
				if (!cancelled) {
					setFetchError(
						err instanceof Error ? err.message : "Failed to load data",
					);
					setLoading(false);
					return;
				}
			}

			if (!cancelled) {
				setNeedsLink(true);
				setLoading(false);
			}
		}

		init();
		return () => {
			cancelled = true;
		};
	}, [loadPageContext]);

	// Listen for popup close message from Whop OAuth
	useEffect(() => {
		function onMessage(event: MessageEvent) {
			if (event.data?.type === "whop-link-result") {
				// Surface any error the popup sent so the user isn't left
				// staring at an unchanged UI wondering what happened.
				if (event.data.error) {
					setFetchError(
						`Whop link failed: ${String(event.data.error)}. Please try again.`,
					);
					return;
				}
				if (!event.data.success) return;
				const newUserId = event.data.userId;
				if (newUserId && typeof sessionStorage !== "undefined") {
					sessionStorage.setItem(WHOP_USER_STORAGE_KEY, newUserId);
				}
				if (newUserId) setCurrentUserId(newUserId);
				setNeedsLink(false);

				// Need at least one identifier for page-context to work.
				if (!ghlCompanyId && !ghlLocationId && !newUserId) {
					setFetchError("Linked, but no context returned. Please reload.");
					return;
				}

				setLoading(true);
				const params: Record<string, string> = {};
				if (ghlCompanyId) params.companyId = ghlCompanyId;
				if (ghlLocationId) params.locationId = ghlLocationId;
				if (newUserId) params.userId = newUserId;
				loadPageContext(params)
					.then((data) => {
						setCtx(data);
						setLoading(false);
						// Remember this account for quick switching later.
						if (newUserId && data.user) {
							rememberUser({
								userId: newUserId,
								name: data.user.name,
								email: data.user.email,
							});
							setKnownUsers(readKnownUsers());
						}
					})
					.catch((err) => {
						setFetchError(
							err instanceof Error ? err.message : "Failed to load data",
						);
						setLoading(false);
					});
			}
		}

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [ghlCompanyId, ghlLocationId, loadPageContext]);

	const handleSwitchAccount = () => {
		if (typeof sessionStorage !== "undefined") {
			sessionStorage.removeItem(WHOP_USER_STORAGE_KEY);
		}
		setCtx(null);
		setCurrentUserId(null);
		// Intentionally KEEP the connectedUsers snapshot so the picker below
		// can still offer every Whop account linked to this GHL subaccount —
		// even ones that were never OAuthed in this browser.
		setNeedsLink(true);
	};

	/**
	 * Quick-switch to an already-authenticated Whop account without re-OAuth.
	 * Uses the saved user list in localStorage. Server-side access is still
	 * verified via the ghl_connection_users join table.
	 */
	const handleQuickSwitch = useCallback(
		async (userId: string) => {
			setFetchError(null);
			setLoading(true);
			try {
				const data = await loadPageContext({
					userId,
					...(ghlCompanyId ? { companyId: ghlCompanyId } : {}),
					...(ghlLocationId ? { locationId: ghlLocationId } : {}),
				});
				if (!data.whopLinked) {
					// User no longer has access to this GHL account.
					forgetUser(userId);
					setKnownUsers(readKnownUsers());
					setFetchError(
						"That account no longer has access to this GoHighLevel location.",
					);
					setLoading(false);
					return;
				}
				if (typeof sessionStorage !== "undefined") {
					sessionStorage.setItem(WHOP_USER_STORAGE_KEY, userId);
				}
				setCurrentUserId(userId);
				setCtx(data);
				setNeedsLink(false);
				setLoading(false);
				if (data.user) {
					rememberUser({
						userId,
						name: data.user.name,
						email: data.user.email,
					});
					setKnownUsers(readKnownUsers());
				}
			} catch (err) {
				setFetchError(
					err instanceof Error ? err.message : "Failed to switch account",
				);
				setLoading(false);
			}
		},
		[ghlCompanyId, ghlLocationId, loadPageContext],
	);

	const handleForgetUser = (userId: string) => {
		forgetUser(userId);
		setKnownUsers(readKnownUsers());
	};

	// Load the list of all Whop users connected to this GHL company/location.
	// We fetch as soon as we have *either* a signed SSO payload (proves
	// GHL-side access to the subaccount) OR a currentUserId (proves backend
	// access). That way a fresh browser with no Whop session yet can still
	// see the list of switchable accounts.
	useEffect(() => {
		if (!ghlCompanyId && !ghlLocationId) return;
		if (!currentUserId && !ghlSsoPayload) return;

		const qs = new URLSearchParams();
		if (currentUserId) qs.set("userId", currentUserId);
		if (ghlCompanyId) qs.set("companyId", ghlCompanyId);
		else if (ghlLocationId) qs.set("locationId", ghlLocationId);

		const headers: Record<string, string> = {};
		if (ghlSsoPayload) headers["x-ghl-sso-payload"] = ghlSsoPayload;

		let cancelled = false;
		fetch(`/api/ghl/connected-users?${qs.toString()}`, { headers })
			.then(async (res) => {
				if (!res.ok) return;
				const data = (await res.json()) as { users?: ConnectedUser[] };
				if (!cancelled) setConnectedUsers(data.users ?? []);
			})
			.catch(() => {
				/* ignore */
			});
		return () => {
			cancelled = true;
		};
	}, [currentUserId, ghlCompanyId, ghlLocationId, ghlSsoPayload]);

	const handleWhopOAuth = () => {
		if (!ghlSsoPayload) {
			setFetchError(
				"Could not read your GoHighLevel session. Please reload this page and try again.",
			);
			return;
		}
		const params = new URLSearchParams();
		// Source of truth for the target GHL company/location is the signed
		// SSO payload — the backend decrypts it to derive identifiers. We
		// intentionally do NOT send unsigned companyId/locationId because an
		// attacker could craft a URL that linked their Whop account to
		// someone else's real GHL company.
		params.set("sso", ghlSsoPayload);

		window.open(
			`/api/ghl/connect-whop?${params.toString()}`,
			"whop-link",
			"width=600,height=700,popup=yes",
		);
	};

	const handleKeyLink = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!keyInput.trim()) return;

		setKeyLoading(true);
		setKeyError(null);

		try {
			const res = await fetch("/api/ext-validate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					connectionKey: keyInput.trim(),
					...(ghlCompanyId ? { companyId: ghlCompanyId } : {}),
				}),
			});

			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as Record<
					string,
					string
				>;
				throw new Error(data.error || "Invalid connection key");
			}

			const result = (await res.json()) as { userId?: string };
			const uid = result.userId;
			if (!uid) throw new Error("Could not identify user");

			if (typeof sessionStorage !== "undefined") {
				sessionStorage.setItem(WHOP_USER_STORAGE_KEY, uid);
			}

			const data = await loadPageContext({
				userId: uid,
				...(ghlCompanyId ? { companyId: ghlCompanyId } : {}),
				...(ghlLocationId ? { locationId: ghlLocationId } : {}),
			});
			setCtx(data);
			setCurrentUserId(uid);
			setNeedsLink(false);
			setShowKeyForm(false);
			if (data.user) {
				rememberUser({
					userId: uid,
					name: data.user.name,
					email: data.user.email,
				});
				setKnownUsers(readKnownUsers());
			}
		} catch (err) {
			setKeyError(err instanceof Error ? err.message : "Link failed");
		} finally {
			setKeyLoading(false);
		}
	};

	if (loading) {
		return (
			<div style={styles.container}>
				<div style={styles.card}>
					<p style={styles.muted}>Loading settings...</p>
				</div>
			</div>
		);
	}

	if (needsLink) {
		// Merge Known Users (per-browser cache) and Connected Users (every
		// Whop account linked to this GHL subaccount) so users can switch to
		// accounts they never OAuthed in this browser.
		const knownIds = new Set(knownUsers.map((u) => u.userId));
		const pickerUsers: Array<{
			userId: string;
			name: string | null;
			email: string | null;
			source: "known" | "connected";
		}> = [
			...knownUsers.map((u) => ({
				userId: u.userId,
				name: u.name,
				email: u.email,
				source: "known" as const,
			})),
			...connectedUsers
				.filter((u) => !knownIds.has(u.userId))
				.map((u) => ({
					userId: u.userId,
					name: u.name,
					email: u.email,
					source: "connected" as const,
				})),
		];

		const ssoReady = !!ghlSsoPayload;

		return (
			<div style={styles.container}>
				<div style={styles.card}>
					<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
						<div style={styles.logoCircle}>EC</div>
						<h1 style={{ ...styles.title, fontSize: 18 }}>Extensible Content</h1>
					</div>

					{fetchError && (
						<div
							style={{
								...styles.errorBanner,
								marginBottom: 12,
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: 8,
							}}
						>
							<span>{fetchError}</span>
							<button
								type="button"
								onClick={() => setFetchError(null)}
								style={{
									background: "transparent",
									border: "none",
									color: "inherit",
									fontSize: 16,
									cursor: "pointer",
								}}
								aria-label="Dismiss"
							>
								×
							</button>
						</div>
					)}

					{!ssoReady && (
						<div
							style={{
								...styles.warningBanner,
								marginBottom: 12,
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: 8,
							}}
						>
							<span>
								Waiting for the GoHighLevel session. If this message
								persists, reload the Custom Page from GHL.
							</span>
							<button
								type="button"
								onClick={() => window.location.reload()}
								style={styles.switchBtn}
							>
								Reload
							</button>
						</div>
					)}

					{pickerUsers.length > 0 && (
						<>
							<p style={{ ...styles.muted, marginBottom: 8 }}>
								Continue as an account linked to this{" "}
								{ghlCompanyId ? "company" : "location"}:
							</p>
							<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
								{pickerUsers.map((u) => (
									<div key={u.userId} style={styles.knownUserRow}>
										<button
											type="button"
											onClick={() => handleQuickSwitch(u.userId)}
											style={styles.knownUserBtn}
										>
											<div style={styles.userAvatar}>
												{(u.name?.[0] || u.email?.[0] || "?").toUpperCase()}
											</div>
											<div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
												<p style={{ ...styles.body, fontWeight: 500 }}>
													{u.name || u.email || u.userId}
													{u.source === "connected" && (
														<span style={styles.youBadge}>linked</span>
													)}
												</p>
												{u.name && u.email && (
													<p style={styles.muted}>{u.email}</p>
												)}
											</div>
										</button>
										{u.source === "known" && (
											<button
												type="button"
												onClick={() => handleForgetUser(u.userId)}
												style={styles.forgetBtn}
												title="Forget this account"
												aria-label="Forget this account"
											>
												×
											</button>
										)}
									</div>
								))}
							</div>
							<div style={{ margin: "4px 0 12px", display: "flex", alignItems: "center", gap: 12 }}>
								<div style={{ flex: 1, height: 1, background: "#e1e4e8" }} />
								<span style={{ fontSize: 12, color: "#888" }}>or</span>
								<div style={{ flex: 1, height: 1, background: "#e1e4e8" }} />
							</div>
						</>
					)}

					{pickerUsers.length === 0 && (
						<p style={styles.body}>
							Link your Whop account to access your workflows, templates, credits,
							and billing from within GoHighLevel.
						</p>
					)}

					<button
						type="button"
						onClick={handleWhopOAuth}
						disabled={!ssoReady}
						style={{
							...styles.primaryBtn,
							marginTop: 4,
							width: "100%",
							padding: "12px 20px",
							fontSize: 15,
							opacity: ssoReady ? 1 : 0.5,
							cursor: ssoReady ? "pointer" : "not-allowed",
						}}
					>
						{pickerUsers.length > 0 ? "Link a different Whop account" : "Link Whop Account"}
					</button>

					<div style={{ margin: "20px 0 12px", display: "flex", alignItems: "center", gap: 12 }}>
						<div style={{ flex: 1, height: 1, background: "#e1e4e8" }} />
						<span style={{ fontSize: 12, color: "#888" }}>or</span>
						<div style={{ flex: 1, height: 1, background: "#e1e4e8" }} />
					</div>

					{!showKeyForm ? (
						<button
							type="button"
							onClick={() => setShowKeyForm(true)}
							style={styles.secondaryBtn}
						>
							Use a Connection Key instead
						</button>
					) : (
						<form
							onSubmit={handleKeyLink}
							style={{ display: "flex", flexDirection: "column", gap: 10 }}
						>
							<p style={styles.muted}>
								Paste the Connection Key from your Extensible Content dashboard
								(Integrations page).
							</p>
							<input
								type="password"
								value={keyInput}
								onChange={(e) => setKeyInput(e.target.value)}
								placeholder="ec_..."
								autoComplete="off"
								style={{
									fontSize: 14,
									padding: "10px 12px",
									borderRadius: 8,
									border: "1px solid #d0d5dd",
									fontFamily: "monospace",
								}}
								disabled={keyLoading}
							/>
							{keyError && <p style={styles.errorBanner}>{keyError}</p>}
							<button
								type="submit"
								disabled={keyLoading || !keyInput.trim()}
								style={{
									...styles.primaryBtn,
									opacity: keyLoading || !keyInput.trim() ? 0.5 : 1,
								}}
							>
								{keyLoading ? "Linking..." : "Link with Key"}
							</button>
						</form>
					)}
				</div>
			</div>
		);
	}

	if (fetchError) {
		return (
			<div style={styles.container}>
				<div style={{ ...styles.card, ...styles.errorBanner }}>
					<p>{fetchError}</p>
				</div>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			<div style={styles.header}>
				<h1 style={styles.title}>Extensible Content Settings</h1>
				{ctx?.locationName && (
					<span style={styles.badge}>{ctx.locationName}</span>
				)}
			</div>

			{connected === "true" && (
				<div style={styles.successBanner}>
					Whop account connected successfully. Reload this page if data
					doesn&apos;t appear.
				</div>
			)}
			{errorParam && (
				<div style={styles.errorBanner}>Connection error: {errorParam}</div>
			)}

			{/* Whop Account */}
			<div style={styles.card}>
				<h2 style={styles.sectionTitle}>Whop Account</h2>
				{ctx?.whopLinked ? (
					<div style={{ ...styles.row, justifyContent: "space-between" }}>
						<div style={styles.row}>
							<div style={styles.statusDot} />
							<div>
								<p style={styles.body}>
									<strong>{ctx.user?.name || "Whop User"}</strong>
								</p>
								<p style={styles.muted}>{ctx.user?.email}</p>
							</div>
						</div>
						<button
							type="button"
							onClick={handleSwitchAccount}
							style={{ ...styles.secondaryBtn, width: "auto" }}
						>
							Switch account
						</button>
					</div>
				) : (
					<div>
						<div style={styles.warningBanner}>
							No Whop account linked to this location.
						</div>
						<button
							type="button"
							onClick={handleWhopOAuth}
							style={styles.primaryBtn}
						>
							Link Whop Account
						</button>
					</div>
				)}
			</div>

			{ctx?.whopLinked && connectedUsers.length > 0 && (
				<div style={styles.card}>
					<h2 style={styles.sectionTitle}>
						Connected Whop Accounts{" "}
						<span style={styles.countBadge}>{connectedUsers.length}</span>
					</h2>
					<p style={{ ...styles.muted, marginBottom: 12 }}>
						These Whop users can access this GoHighLevel{" "}
						{ghlCompanyId ? "company" : "location"}. Click any account to
						switch to it — you don&apos;t need to re-authenticate if that
						account has already been linked.
					</p>
					<ul style={styles.userList}>
						{connectedUsers.map((u) => (
							<li key={u.userId} style={styles.userItem}>
								<div style={styles.userAvatar}>
									{(u.name?.[0] || u.email?.[0] || "?").toUpperCase()}
								</div>
								<div style={{ flex: 1, minWidth: 0 }}>
									<p style={{ ...styles.body, fontWeight: 500 }}>
										{u.name || u.email || u.userId}
										{u.isSelf && (
											<span style={styles.youBadge}>you</span>
										)}
									</p>
									{u.name && u.email && (
										<p style={styles.muted}>{u.email}</p>
									)}
								</div>
								<span style={styles.muted}>
									{new Date(u.linkedAt).toLocaleDateString()}
								</span>
								{!u.isSelf && (
									<button
										type="button"
										onClick={() => handleQuickSwitch(u.userId)}
										style={styles.switchBtn}
										disabled={loading}
										title={`Switch to ${u.name || u.email || "this account"}`}
									>
										Switch
									</button>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{ctx?.whopLinked && ghlLocationId && currentUserId && (
				<div style={styles.card}>
					<h2 style={styles.sectionTitle}>
						Social Planner{" "}
						{scheduledPosts.length > 0 && (
							<span style={styles.countBadge}>{scheduledPosts.length}</span>
						)}
					</h2>
					<p style={{ ...styles.muted, marginBottom: 12 }}>
						Posts scheduled from Extensible Content to this location. Our
						backend publishes them on time even if nobody is online.
					</p>

					{scheduledError && (
						<div style={{ ...styles.errorBanner, marginBottom: 12 }}>
							{scheduledError}
						</div>
					)}

					{scheduledLoading && scheduledPosts.length === 0 ? (
						<p style={styles.muted}>Loading…</p>
					) : scheduledPosts.length === 0 ? (
						<p style={styles.muted}>
							No scheduled posts yet. Schedule from the Whop app or the Chrome
							extension.
						</p>
					) : (
						<ul style={styles.scheduledList}>
							{scheduledPosts.map((p) => (
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
										{p.status === "pending" && (
											<button
												type="button"
												disabled={cancellingId === p.id}
												onClick={() =>
													cancelScheduledPost(
														p.id,
														currentUserId,
														ghlLocationId,
													)
												}
												style={styles.linkDangerBtn}
											>
												{cancellingId === p.id ? "…" : "Cancel"}
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
									{p.payload?.accountIds &&
										p.payload.accountIds.length > 0 && (
											<p style={{ ...styles.muted, marginTop: 4 }}>
												{p.payload.accountIds.length} channel
												{p.payload.accountIds.length === 1 ? "" : "s"}
											</p>
										)}
									{p.last_error && (
										<p
											style={{
												...styles.muted,
												marginTop: 4,
												color: "#82071e",
											}}
										>
											Error: {p.last_error}
										</p>
									)}
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			{ctx?.whopLinked && (
				<>
					{/* Workflows */}
					<div style={styles.card}>
						<h2 style={styles.sectionTitle}>Workflows</h2>
						{!ctx.workflows?.length ? (
							<p style={styles.muted}>
								No workflows yet. Create workflows in the Chrome extension.
							</p>
						) : (
							<div style={styles.tableWrap}>
								<table style={styles.table}>
									<thead>
										<tr>
											<th style={styles.th}>Name</th>
											<th style={styles.th}>Version</th>
											<th style={styles.th}>Status</th>
											<th style={styles.th}>Created</th>
										</tr>
									</thead>
									<tbody>
										{ctx.workflows.map((wf) => (
											<tr key={wf.id}>
												<td style={styles.td}>{wf.name}</td>
												<td style={styles.td}>{wf.version}</td>
												<td style={styles.td}>
													{wf.published ? (
														<span style={styles.tagGreen}>Published</span>
													) : wf.private ? (
														<span style={styles.tagGray}>Private</span>
													) : (
														<span style={styles.tagGray}>Draft</span>
													)}
												</td>
												<td style={styles.tdMuted}>
													{new Date(wf.created_at).toLocaleDateString()}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>

					{/* ShotStack */}
					<div style={styles.card}>
						<h2 style={styles.sectionTitle}>ShotStack</h2>
						<div style={styles.statsRow}>
							<div style={styles.stat}>
								<p style={styles.statValue}>
									{ctx.shotstack?.spendableCredits?.toFixed(2) ?? "0.00"}
								</p>
								<p style={styles.statLabel}>Spendable Credits</p>
							</div>
							<div style={styles.stat}>
								<p style={styles.statValue}>
									{ctx.shotstack?.hasByok ? "Configured" : "Not Set"}
								</p>
								<p style={styles.statLabel}>BYOK API Key</p>
							</div>
							<div style={styles.stat}>
								<p style={styles.statValue}>{ctx.templates?.length ?? 0}</p>
								<p style={styles.statLabel}>Saved Templates</p>
							</div>
						</div>

						{ctx.templates && ctx.templates.length > 0 && (
							<>
								<h3 style={styles.subTitle}>Templates</h3>
								<div style={styles.tableWrap}>
									<table style={styles.table}>
										<thead>
											<tr>
												<th style={styles.th}>Name</th>
												<th style={styles.th}>Environment</th>
												<th style={styles.th}>Updated</th>
											</tr>
										</thead>
										<tbody>
											{ctx.templates.map((tpl) => (
												<tr key={tpl.id}>
													<td style={styles.td}>{tpl.name}</td>
													<td style={styles.td}>
														{tpl.default_env === "v1"
															? "Production"
															: "Staging"}
													</td>
													<td style={styles.tdMuted}>
														{new Date(tpl.updated_at).toLocaleDateString()}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</>
						)}
					</div>

					{/* Billing */}
					<div style={styles.card}>
						<h2 style={styles.sectionTitle}>Billing & Plan</h2>
						<div style={styles.statsRow}>
							<div style={styles.stat}>
								<p style={styles.statValue}>
									{ctx.user?.hasUpgraded ? (
										<span style={styles.tagGreen}>Pro</span>
									) : (
										<span style={styles.tagGray}>Free</span>
									)}
								</p>
								<p style={styles.statLabel}>Plan Tier</p>
							</div>
							<div style={styles.stat}>
								<p style={styles.statValue}>
									{ctx.uploadPostAccounts ?? 0} /{" "}
									{ctx.user?.maxUploadPostAccounts ?? 0}
								</p>
								<p style={styles.statLabel}>Upload-Post Accounts</p>
							</div>
							<div style={styles.stat}>
								<p style={styles.statValue}>
									{formatBytes(ctx.user?.maxStorageBytes ?? 0)}
								</p>
								<p style={styles.statLabel}>Storage Limit</p>
							</div>
						</div>
						<a
							href="https://whop.com/orders"
							target="_blank"
							rel="noopener noreferrer"
							style={styles.link}
						>
							Manage billing on Whop →
						</a>
					</div>
				</>
			)}
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	container: {
		fontFamily: "system-ui, -apple-system, sans-serif",
		maxWidth: 800,
		margin: "0 auto",
		padding: "24px 16px",
		display: "flex",
		flexDirection: "column",
		gap: 20,
	},
	header: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		flexWrap: "wrap",
	},
	title: {
		fontSize: 22,
		fontWeight: 700,
		color: "#111",
		margin: 0,
	},
	badge: {
		fontSize: 12,
		fontWeight: 500,
		background: "#e8f4fd",
		color: "#0969da",
		padding: "3px 10px",
		borderRadius: 12,
	},
	card: {
		border: "1px solid #e1e4e8",
		borderRadius: 10,
		padding: 20,
		background: "#fff",
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: 600,
		color: "#111",
		margin: "0 0 14px 0",
	},
	subTitle: {
		fontSize: 14,
		fontWeight: 600,
		color: "#333",
		margin: "16px 0 8px 0",
	},
	row: {
		display: "flex",
		alignItems: "center",
		gap: 12,
	},
	statusDot: {
		width: 10,
		height: 10,
		borderRadius: "50%",
		background: "#2da44e",
		flexShrink: 0,
	},
	body: {
		margin: 0,
		fontSize: 14,
		color: "#111",
	},
	muted: {
		margin: 0,
		fontSize: 13,
		color: "#666",
	},
	successBanner: {
		fontSize: 13,
		padding: "10px 14px",
		borderRadius: 8,
		background: "#dafbe1",
		color: "#116329",
		border: "1px solid #aceebb",
	},
	warningBanner: {
		fontSize: 13,
		padding: "10px 14px",
		borderRadius: 8,
		background: "#fff8c5",
		color: "#6a5600",
		border: "1px solid #f0db4f",
		marginBottom: 12,
	},
	errorBanner: {
		fontSize: 13,
		padding: "10px 14px",
		borderRadius: 8,
		background: "#ffebe9",
		color: "#82071e",
		border: "1px solid #ff8182",
	},
	primaryBtn: {
		fontSize: 14,
		fontWeight: 500,
		padding: "8px 20px",
		borderRadius: 6,
		border: "none",
		background: "#2563eb",
		color: "#fff",
		cursor: "pointer",
	},
	secondaryBtn: {
		fontSize: 13,
		fontWeight: 500,
		padding: "8px 16px",
		borderRadius: 6,
		border: "1px solid #d0d5dd",
		background: "#fff",
		color: "#333",
		cursor: "pointer",
		width: "100%",
	},
	statsRow: {
		display: "flex",
		gap: 24,
		flexWrap: "wrap" as const,
		marginBottom: 12,
	},
	stat: {
		flex: "1 1 120px",
		minWidth: 120,
	},
	statValue: {
		fontSize: 20,
		fontWeight: 700,
		color: "#111",
		margin: 0,
	},
	statLabel: {
		fontSize: 12,
		color: "#666",
		margin: "2px 0 0 0",
	},
	tableWrap: {
		overflowX: "auto" as const,
		border: "1px solid #e1e4e8",
		borderRadius: 8,
	},
	table: {
		width: "100%",
		borderCollapse: "collapse" as const,
		fontSize: 13,
	},
	th: {
		textAlign: "left" as const,
		padding: "8px 12px",
		fontWeight: 600,
		color: "#333",
		background: "#f6f8fa",
		borderBottom: "1px solid #e1e4e8",
	},
	td: {
		padding: "8px 12px",
		color: "#111",
		borderBottom: "1px solid #f0f0f0",
	},
	tdMuted: {
		padding: "8px 12px",
		color: "#666",
		borderBottom: "1px solid #f0f0f0",
	},
	tagGreen: {
		fontSize: 11,
		fontWeight: 500,
		background: "#dafbe1",
		color: "#116329",
		padding: "2px 8px",
		borderRadius: 10,
	},
	tagGray: {
		fontSize: 11,
		fontWeight: 500,
		background: "#f0f0f0",
		color: "#666",
		padding: "2px 8px",
		borderRadius: 10,
	},
	link: {
		fontSize: 13,
		color: "#0969da",
		textDecoration: "none",
	},
	knownUserRow: {
		display: "flex",
		alignItems: "stretch",
		gap: 6,
	},
	knownUserBtn: {
		flex: 1,
		display: "flex",
		alignItems: "center",
		gap: 12,
		padding: "10px 12px",
		border: "1px solid #d0d5dd",
		borderRadius: 8,
		background: "#fff",
		cursor: "pointer",
		textAlign: "left" as const,
		fontFamily: "inherit",
	},
	forgetBtn: {
		fontSize: 18,
		fontWeight: 400,
		padding: "0 12px",
		borderRadius: 8,
		border: "1px solid #d0d5dd",
		background: "#fff",
		color: "#666",
		cursor: "pointer",
		lineHeight: 1,
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
		verticalAlign: "middle",
	},
	userList: {
		listStyle: "none",
		margin: 0,
		padding: 0,
		display: "flex",
		flexDirection: "column",
		gap: 8,
	},
	userItem: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		padding: "10px 12px",
		border: "1px solid #e1e4e8",
		borderRadius: 8,
		background: "#fafbfc",
	},
	userAvatar: {
		width: 32,
		height: 32,
		borderRadius: "50%",
		background: "#e0e7ff",
		color: "#4338ca",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 13,
		fontWeight: 700,
		flexShrink: 0,
	},
	youBadge: {
		display: "inline-block",
		marginLeft: 8,
		fontSize: 10,
		fontWeight: 600,
		textTransform: "uppercase" as const,
		background: "#dafbe1",
		color: "#116329",
		padding: "1px 6px",
		borderRadius: 6,
		verticalAlign: "middle",
	},
	logoCircle: {
		width: 36,
		height: 36,
		borderRadius: "50%",
		background: "#2563eb",
		color: "#fff",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 13,
		fontWeight: 700,
		flexShrink: 0,
	},
	switchBtn: {
		marginLeft: 12,
		fontSize: 12,
		fontWeight: 500,
		padding: "6px 12px",
		borderRadius: 6,
		border: "1px solid #d0d5dd",
		background: "#fff",
		color: "#111",
		cursor: "pointer",
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
