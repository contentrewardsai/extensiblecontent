"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function ExtLoginPage() {
	const searchParams = useSearchParams();
	const redirectUri = searchParams.get("redirect_uri") ?? "";
	const state = searchParams.get("state") ?? "";

	const [key, setKey] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!key.trim()) return;

		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/ext-login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					connectionKey: key.trim(),
					redirectUri,
					state,
				}),
			});

			const data = (await res.json()) as {
				redirectUrl?: string;
				error?: string;
			};

			if (!res.ok || !data.redirectUrl) {
				setError(data.error || "Invalid connection key. Please try again.");
				setLoading(false);
				return;
			}

			window.location.href = data.redirectUrl;
		} catch {
			setError("Something went wrong. Please try again.");
			setLoading(false);
		}
	};

	if (!redirectUri || !state) {
		return (
			<div style={styles.container}>
				<div style={{ ...styles.card, ...styles.errorCard }}>
					<p>Invalid request. This page must be opened by GoHighLevel during app installation.</p>
				</div>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			<div style={styles.card}>
				<div style={styles.logoArea}>
					<div style={styles.logoCircle}>EC</div>
					<h1 style={styles.title}>Extensible Content</h1>
				</div>

				<p style={styles.subtitle}>
					Enter your Connection Key to link your account with GoHighLevel.
				</p>

				<form onSubmit={handleSubmit} style={styles.form}>
					<label htmlFor="connectionKey" style={styles.label}>
						Connection Key
					</label>
					<input
						id="connectionKey"
						type="password"
						value={key}
						onChange={(e) => setKey(e.target.value)}
						placeholder="ec_..."
						autoComplete="off"
						style={styles.input}
						disabled={loading}
					/>

					{error && <p style={styles.error}>{error}</p>}

					<button
						type="submit"
						disabled={loading || !key.trim()}
						style={{
							...styles.button,
							...(loading || !key.trim() ? styles.buttonDisabled : {}),
						}}
					>
						{loading ? "Verifying..." : "Connect Account"}
					</button>
				</form>

				<div style={styles.helpSection}>
					<p style={styles.helpText}>
						Don&apos;t have a key? Generate one from your{" "}
						<a
							href="https://whop.com"
							target="_blank"
							rel="noopener noreferrer"
							style={styles.link}
						>
							Extensible Content dashboard
						</a>{" "}
						under Integrations &gt; GoHighLevel.
					</p>
				</div>
			</div>
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	container: {
		fontFamily: "system-ui, -apple-system, sans-serif",
		minHeight: "100vh",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: 16,
		background: "#f5f6f8",
	},
	card: {
		width: "100%",
		maxWidth: 420,
		background: "#fff",
		borderRadius: 12,
		border: "1px solid #e1e4e8",
		padding: "32px 28px",
		boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
	},
	errorCard: {
		textAlign: "center" as const,
		color: "#82071e",
		background: "#ffebe9",
		border: "1px solid #ff8182",
	},
	logoArea: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		marginBottom: 20,
	},
	logoCircle: {
		width: 40,
		height: 40,
		borderRadius: "50%",
		background: "#2563eb",
		color: "#fff",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 14,
		fontWeight: 700,
		flexShrink: 0,
	},
	title: {
		fontSize: 20,
		fontWeight: 700,
		color: "#111",
		margin: 0,
	},
	subtitle: {
		fontSize: 14,
		color: "#555",
		margin: "0 0 24px 0",
		lineHeight: 1.5,
	},
	form: {
		display: "flex",
		flexDirection: "column" as const,
		gap: 12,
	},
	label: {
		fontSize: 13,
		fontWeight: 600,
		color: "#333",
	},
	input: {
		fontSize: 14,
		padding: "10px 12px",
		borderRadius: 8,
		border: "1px solid #d0d5dd",
		outline: "none",
		fontFamily: "monospace",
		transition: "border-color 0.15s",
	},
	error: {
		fontSize: 13,
		color: "#d1242f",
		margin: 0,
		padding: "8px 12px",
		background: "#ffebe9",
		borderRadius: 6,
		border: "1px solid #ff8182",
	},
	button: {
		fontSize: 14,
		fontWeight: 600,
		padding: "10px 20px",
		borderRadius: 8,
		border: "none",
		background: "#2563eb",
		color: "#fff",
		cursor: "pointer",
		marginTop: 4,
		transition: "background 0.15s",
	},
	buttonDisabled: {
		opacity: 0.5,
		cursor: "not-allowed",
	},
	helpSection: {
		marginTop: 20,
		paddingTop: 16,
		borderTop: "1px solid #eee",
	},
	helpText: {
		fontSize: 12,
		color: "#666",
		lineHeight: 1.6,
		margin: 0,
	},
	link: {
		color: "#2563eb",
		textDecoration: "none",
	},
};
