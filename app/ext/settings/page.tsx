"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface GhlUserContext {
	userId: string;
	companyId: string;
	role: string;
	type: "agency" | "location";
	userName: string;
	email: string;
	isAgencyOwner: boolean;
	activeLocation?: string;
	versionId: string;
	appStatus: string;
}

interface PageContext {
	whopLinked: boolean;
	locationId: string;
	locationName: string | null;
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
 * Retries every 1.5s for up to 15s since GHL may not have its listener ready
 * immediately when the iframe loads.
 */
function requestSsoKey(): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let resolved = false;

		function listener(event: MessageEvent) {
			if (event.data?.message === "REQUEST_USER_DATA_RESPONSE" && !resolved) {
				resolved = true;
				clearInterval(retryInterval);
				clearTimeout(timeout);
				window.removeEventListener("message", listener);
				resolve(event.data.payload);
			}
		}

		window.addEventListener("message", listener);

		// Send immediately, then retry every 1.5s
		const targets = [window.parent, window.top].filter(
			(w): w is Window => w !== null && w !== window,
		);
		function sendRequest() {
			for (const target of targets) {
				try {
					target.postMessage({ message: "REQUEST_USER_DATA" }, "*");
				} catch {
					// cross-origin access error, ignore
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
				reject(new Error("SSO response timed out"));
			}
		}, 15_000);
	});
}

export default function GhlSettingsPage() {
	const searchParams = useSearchParams();
	const connected = searchParams.get("connected");
	const errorParam = searchParams.get("error");

	const [ctx, setCtx] = useState<PageContext | null>(null);
	const [loading, setLoading] = useState(true);
	const [needsLogin, setNeedsLogin] = useState(false);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [keyInput, setKeyInput] = useState("");
	const [keyLoading, setKeyLoading] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);
	const [userId, setUserId] = useState<string | null>(null);

	const loadPageContext = useCallback(
		async (uid: string) => {
			try {
				const res = await fetch(
					`/api/ghl/page-context?userId=${encodeURIComponent(uid)}`,
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as PageContext;
				setCtx(data);
			} catch (err) {
				setFetchError(err instanceof Error ? err.message : "Failed to load data");
			}
		},
		[],
	);

	// Try SSO first, fall back to Connection Key login
	useEffect(() => {
		let cancelled = false;

		async function init() {
			setLoading(true);

			// Check if we have a cached session
			const cachedUserId = sessionStorage.getItem("ec_ghl_user_id");
			if (cachedUserId) {
				setUserId(cachedUserId);
				await loadPageContext(cachedUserId);
				if (!cancelled) setLoading(false);
				return;
			}

			// Try SSO
			try {
				const encryptedPayload = await requestSsoKey();
				const res = await fetch("/api/ghl/sso", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ payload: encryptedPayload }),
				});
				if (!res.ok) throw new Error("SSO decryption failed");
				const userContext = (await res.json()) as GhlUserContext;

				if (cancelled) return;

				const locationId = userContext.activeLocation || userContext.companyId;
				if (locationId) {
					await loadPageContext(locationId);
				}
				if (!cancelled) setLoading(false);
				return;
			} catch {
				// SSO failed -- fall back to Connection Key login
			}

			if (!cancelled) {
				setNeedsLogin(true);
				setLoading(false);
			}
		}

		init();
		return () => {
			cancelled = true;
		};
	}, [loadPageContext]);

	const handleKeyLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!keyInput.trim()) return;

		setKeyLoading(true);
		setKeyError(null);

		try {
			const res = await fetch("/api/ext-login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					connectionKey: keyInput.trim(),
					redirectUri: "settings-page",
					state: "settings-page",
				}),
			});

			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as Record<string, string>;
				throw new Error(data.error || "Invalid connection key");
			}

			// Key is valid -- get the userId from the validate endpoint
			const validateRes = await fetch("/api/ext-validate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ connectionKey: keyInput.trim() }),
			});

			if (!validateRes.ok) {
				throw new Error("Connection key validation failed");
			}

			const validateData = (await validateRes.json()) as { userId?: string };
			const uid = validateData.userId;

			if (!uid) {
				throw new Error("Could not identify user");
			}

			sessionStorage.setItem("ec_ghl_user_id", uid);
			setUserId(uid);
			setNeedsLogin(false);
			setLoading(true);
			await loadPageContext(uid);
			setLoading(false);
		} catch (err) {
			setKeyError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setKeyLoading(false);
		}
	};

	const handleConnectWhop = () => {
		const locId = ctx?.locationId || "";
		window.open(
			`/api/ghl/connect-whop?locationId=${encodeURIComponent(locId)}`,
			"_blank",
			"width=600,height=700",
		);
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

	if (needsLogin) {
		return (
			<div style={styles.container}>
				<div style={styles.card}>
					<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
						<div style={styles.logoCircle}>EC</div>
						<h1 style={{ ...styles.title, fontSize: 18 }}>Extensible Content</h1>
					</div>
					<p style={styles.muted}>
						Enter your Connection Key to view your settings. Generate a key from your
						Extensible Content dashboard under Integrations.
					</p>
					<form onSubmit={handleKeyLogin} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
						<input
							type="password"
							value={keyInput}
							onChange={(e) => setKeyInput(e.target.value)}
							placeholder="ec_..."
							autoComplete="off"
							style={{ fontSize: 14, padding: "10px 12px", borderRadius: 8, border: "1px solid #d0d5dd", fontFamily: "monospace" }}
							disabled={keyLoading}
						/>
						{keyError && <p style={styles.errorBanner}>{keyError}</p>}
						<button
							type="submit"
							disabled={keyLoading || !keyInput.trim()}
							style={{ ...styles.primaryBtn, opacity: keyLoading || !keyInput.trim() ? 0.5 : 1 }}
						>
							{keyLoading ? "Verifying..." : "Connect"}
						</button>
					</form>
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
					Whop account connected successfully. Reload this page if data doesn't appear.
				</div>
			)}
			{errorParam && (
				<div style={styles.errorBanner}>
					Connection error: {errorParam}
				</div>
			)}

			{/* Section 1: Whop Account Connection */}
			<div style={styles.card}>
				<h2 style={styles.sectionTitle}>Whop Account</h2>
				{ctx?.whopLinked ? (
					<div style={styles.row}>
						<div style={styles.statusDot} />
						<div>
							<p style={styles.body}>
								<strong>{ctx.user?.name || "Whop User"}</strong>
							</p>
							<p style={styles.muted}>{ctx.user?.email}</p>
						</div>
					</div>
				) : (
					<div>
						<div style={styles.warningBanner}>
							No Whop account linked to this location. Connect your account to view
							your workflows, templates, credits, and billing.
						</div>
						<button type="button" onClick={handleConnectWhop} style={styles.primaryBtn}>
							Connect Whop Account
						</button>
					</div>
				)}
			</div>

			{ctx?.whopLinked && (
				<>
					{/* Section 2: Workflows */}
					<div style={styles.card}>
						<h2 style={styles.sectionTitle}>Workflows</h2>
						{!ctx.workflows?.length ? (
							<p style={styles.muted}>No workflows yet. Create workflows in the Chrome extension.</p>
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

					{/* Section 3: ShotStack */}
					<div style={styles.card}>
						<h2 style={styles.sectionTitle}>ShotStack</h2>
						<div style={styles.statsRow}>
							<div style={styles.stat}>
								<p style={styles.statValue}>{ctx.shotstack?.spendableCredits?.toFixed(2) ?? "0.00"}</p>
								<p style={styles.statLabel}>Spendable Credits</p>
							</div>
							<div style={styles.stat}>
								<p style={styles.statValue}>{ctx.shotstack?.hasByok ? "Configured" : "Not Set"}</p>
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
													<td style={styles.td}>{tpl.default_env === "v1" ? "Production" : "Staging"}</td>
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

					{/* Section 4: Billing and Plan */}
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
									{ctx.uploadPostAccounts ?? 0} / {ctx.user?.maxUploadPostAccounts ?? 0}
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
};
