"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface PageContext {
	whopLinked: boolean;
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
}> {
	return new Promise((resolve, reject) => {
		let resolved = false;

		function listener(event: MessageEvent) {
			if (event.data?.message === "REQUEST_USER_DATA_RESPONSE" && !resolved) {
				resolved = true;
				clearInterval(retryInterval);
				clearTimeout(timeout);
				window.removeEventListener("message", listener);

				fetch("/api/ghl/sso", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ payload: event.data.payload }),
				})
					.then((res) => {
						if (!res.ok) throw new Error("SSO decryption failed");
						return res.json();
					})
					.then((data) => resolve(data))
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

	// Connection Key fallback
	const [showKeyForm, setShowKeyForm] = useState(false);
	const [keyInput, setKeyInput] = useState("");
	const [keyLoading, setKeyLoading] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);

	// GHL identifiers from SSO
	const [ghlCompanyId, setGhlCompanyId] = useState<string | null>(null);
	const [ghlLocationId, setGhlLocationId] = useState<string | null>(null);

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

	// Init: SSO → backend lookup → show settings or link prompt
	useEffect(() => {
		let cancelled = false;

		async function init() {
			setLoading(true);

			let companyId: string | null = null;
			let locationId: string | null = null;

			try {
				const sso = await requestSsoContext();
				companyId = sso.companyId || null;
				locationId = sso.activeLocation || null;
			} catch {
				// SSO not available
			}

			if (cancelled) return;

			if (companyId) setGhlCompanyId(companyId);
			if (locationId) setGhlLocationId(locationId);

			if (companyId || locationId) {
				try {
					const data = await loadPageContext({
						companyId: companyId ?? undefined,
						locationId: locationId ?? undefined,
					});

					if (cancelled) return;

					if (data.whopLinked) {
						setCtx(data);
						setLoading(false);
						return;
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
			if (event.data?.type === "whop-link-result" && event.data.success) {
				// Accounts linked — reload settings
				setNeedsLink(false);
				setLoading(true);
				const params: Record<string, string> = {};
				if (ghlCompanyId) params.companyId = ghlCompanyId;
				if (ghlLocationId) params.locationId = ghlLocationId;
				if (event.data.userId) params.userId = event.data.userId;
				loadPageContext(params)
					.then((data) => {
						setCtx(data);
						setLoading(false);
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

	const handleWhopOAuth = () => {
		const params = new URLSearchParams();
		if (ghlCompanyId) params.set("companyId", ghlCompanyId);
		if (ghlLocationId) params.set("locationId", ghlLocationId);

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

			const data = await loadPageContext({ userId: uid });
			setCtx(data);
			setNeedsLink(false);
			setShowKeyForm(false);
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
		return (
			<div style={styles.container}>
				<div style={styles.card}>
					<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
						<div style={styles.logoCircle}>EC</div>
						<h1 style={{ ...styles.title, fontSize: 18 }}>Extensible Content</h1>
					</div>

					<p style={styles.body}>
						Link your Whop account to access your workflows, templates, credits,
						and billing from within GoHighLevel.
					</p>

					<button
						type="button"
						onClick={handleWhopOAuth}
						style={{ ...styles.primaryBtn, marginTop: 16, width: "100%", padding: "12px 20px", fontSize: 15 }}
					>
						Link Whop Account
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
