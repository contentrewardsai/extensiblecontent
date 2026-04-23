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
 * Returns the encrypted base64 payload.
 */
function requestSsoKey(): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");

		const timeout = setTimeout(() => {
			window.removeEventListener("message", listener);
			reject(new Error("SSO response timed out"));
		}, 10_000);

		function listener(event: MessageEvent) {
			if (event.data?.message === "REQUEST_USER_DATA_RESPONSE") {
				clearTimeout(timeout);
				window.removeEventListener("message", listener);
				resolve(event.data.payload);
			}
		}

		window.addEventListener("message", listener);
	});
}

export default function GhlSettingsPage() {
	const searchParams = useSearchParams();
	const connected = searchParams.get("connected");
	const errorParam = searchParams.get("error");

	const [ghlUser, setGhlUser] = useState<GhlUserContext | null>(null);
	const [ctx, setCtx] = useState<PageContext | null>(null);
	const [loading, setLoading] = useState(true);
	const [ssoError, setSsoError] = useState<string | null>(null);
	const [fetchError, setFetchError] = useState<string | null>(null);

	const decryptSso = useCallback(async () => {
		try {
			const encryptedPayload = await requestSsoKey();
			const res = await fetch("/api/ghl/sso", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ payload: encryptedPayload }),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(
					(err as Record<string, string>).error ||
						`SSO decryption failed (${res.status})`,
				);
			}
			const userContext = (await res.json()) as GhlUserContext;
			setGhlUser(userContext);
			return userContext;
		} catch (err) {
			setSsoError(
				err instanceof Error ? err.message : "Failed to authenticate with GoHighLevel",
			);
			return null;
		}
	}, []);

	const loadPageContext = useCallback(
		async (locationId: string) => {
			try {
				const res = await fetch(
					`/api/ghl/page-context?locationId=${encodeURIComponent(locationId)}`,
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

	useEffect(() => {
		let cancelled = false;

		async function init() {
			setLoading(true);

			const userContext = await decryptSso();
			if (cancelled) return;

			if (!userContext) {
				setLoading(false);
				return;
			}

			const locationId = userContext.activeLocation || userContext.companyId;
			if (!locationId) {
				setSsoError("No active location found in GHL context");
				setLoading(false);
				return;
			}

			await loadPageContext(locationId);
			if (!cancelled) setLoading(false);
		}

		init();
		return () => {
			cancelled = true;
		};
	}, [decryptSso, loadPageContext]);

	const handleConnectWhop = () => {
		const locationId = ghlUser?.activeLocation || ghlUser?.companyId || "";
		window.open(
			`/api/ghl/connect-whop?locationId=${encodeURIComponent(locationId)}`,
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

	if (ssoError) {
		return (
			<div style={styles.container}>
				<div style={{ ...styles.card, ...styles.errorBanner }}>
					<p style={{ margin: 0 }}>{ssoError}</p>
					<p style={{ ...styles.muted, marginTop: 8 }}>
						This page must be opened from within GoHighLevel.
					</p>
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
};
