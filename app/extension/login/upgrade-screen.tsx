"use client";

import { useEffect, useState } from "react";
import type { PlanCheckoutResponseEntry } from "@/app/api/extension/plans/route";

const PRIMARY = "#00e676";
const PRIMARY_DARK = "#00c853";
const TEXT_DARK = "#1a202c";
const TEXT_LIGHT = "#4a5568";
const BG_LIGHT = "#f4f7f6";
const CARD_BG = "#ffffff";

const POSTING_LIMITS: ReadonlyArray<{ network: string; perDay: number }> = [
	{ network: "LinkedIn", perDay: 150 },
	{ network: "Instagram", perDay: 50 },
	{ network: "X (Twitter)", perDay: 50 },
	{ network: "Threads", perDay: 50 },
	{ network: "Bluesky", perDay: 50 },
	{ network: "Reddit", perDay: 40 },
	{ network: "Facebook", perDay: 25 },
	{ network: "Pinterest", perDay: 20 },
	{ network: "TikTok", perDay: 15 },
	{ network: "YouTube", perDay: 10 },
];

/**
 * Per-tier marketing copy. Mirrors the marketing site design while the
 * actual entitlements granted on purchase come from `PLAN_TIERS` server-side
 * (keyed by the same `productId`).
 */
const TIER_COPY: Record<
	string,
	{
		displayName: string;
		profilesLine: { primary: string; secondary: string };
		storageLine: { primary: string; secondary: string };
		creditsLine: { primary: string; secondary: string };
	}
> = {
	prod_SKbivMikKZ0DZ: {
		displayName: "Creator",
		profilesLine: { primary: "1 Set of Profiles", secondary: "Up to 1 account per social network*" },
		storageLine: { primary: "10 GB Storage", secondary: "Video Storage for Remote Posting" },
		creditsLine: { primary: "30 ShotStack Credits", secondary: "1 min/credit, up to 3mo rollover" },
	},
	prod_ShvmpSR7s0EoH: {
		displayName: "Growth",
		profilesLine: { primary: "10 Sets of Profiles", secondary: "Up to 10 accounts per social network*" },
		storageLine: { primary: "40 GB Storage", secondary: "Video Storage for Remote Posting" },
		creditsLine: { primary: "150 ShotStack Credits", secondary: "1 min/credit, up to 3mo rollover" },
	},
	prod_G67Rs4iAZtexG: {
		displayName: "Scale",
		profilesLine: { primary: "25 Sets of Profiles", secondary: "Up to 25 accounts per social network*" },
		storageLine: { primary: "100 GB Storage", secondary: "Video Storage for Remote Posting" },
		creditsLine: { primary: "375 ShotStack Credits", secondary: "1 min/credit, up to 3mo rollover" },
	},
};

const POPULAR_PRODUCT_ID = "prod_ShvmpSR7s0EoH";

interface UpgradeScreenProps {
	userEmail?: string;
}

export function ExtensionUpgradeScreen({ userEmail }: UpgradeScreenProps) {
	const [plans, setPlans] = useState<PlanCheckoutResponseEntry[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch("/api/extension/plans", { cache: "no-store" });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as { plans: PlanCheckoutResponseEntry[] };
				if (!cancelled) setPlans(data.plans);
			} catch (err) {
				if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load plans");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const handlePurchase = (url: string | null) => {
		if (!url) return;
		window.open(url, "_blank", "noopener,noreferrer");
	};

	const sortedPlans = plans ? [...plans].sort((a, b) => a.rank - b.rank) : null;

	return (
		<div style={{ backgroundColor: BG_LIGHT, color: TEXT_DARK, minHeight: "100vh" }}>
			<div
				style={{
					maxWidth: 1100,
					margin: "0 auto",
					padding: "60px 20px",
					fontFamily:
						"'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
					lineHeight: 1.6,
				}}
			>
				<header style={{ textAlign: "center", marginBottom: 48 }}>
					<p
						style={{
							display: "inline-block",
							margin: "0 0 16px 0",
							padding: "6px 14px",
							borderRadius: 999,
							background: "#e8fdf2",
							color: "#027a48",
							fontSize: "0.85em",
							fontWeight: 600,
							letterSpacing: 0.5,
							textTransform: "uppercase",
						}}
					>
						You&apos;re signed in{userEmail ? ` as ${userEmail}` : ""}
					</p>
					<h1
						style={{
							color: TEXT_DARK,
							fontSize: "2.6em",
							margin: "0 0 12px 0",
							fontWeight: 800,
							lineHeight: 1.2,
						}}
					>
						Supercharge Your Reach
					</h1>
					<p
						style={{
							fontSize: "1.15em",
							color: TEXT_LIGHT,
							maxWidth: 700,
							margin: "0 auto",
						}}
					>
						You&apos;ve got the keys to the ultimate content engine. To truly scale your brand,
						automate your posting, and turn views into passive income, it&apos;s time to upgrade.
					</p>
				</header>

				<div
					style={{
						textAlign: "center",
						marginBottom: 36,
						padding: 20,
						background: "#e8fdf2",
						borderRadius: 12,
						color: "#027a48",
						fontSize: "1.05em",
						boxShadow: "0 4px 6px rgba(0,0,0,0.02)",
					}}
				>
					<strong>All plans include:</strong> Unlimited Team Members &bull; Remote Chrome Extension
					Management &bull; Automated Monetization Clipping &bull; Template &amp; Workflow Library
					Access
				</div>

				{loadError ? (
					<div
						style={{
							background: "#fef2f2",
							border: "1px solid #fecaca",
							color: "#991b1b",
							padding: 20,
							borderRadius: 12,
							textAlign: "center",
							marginBottom: 40,
						}}
					>
						Couldn&apos;t load checkout links: {loadError}. You can still upgrade from the
						in-app billing page.
					</div>
				) : null}

				<section
					style={{
						display: "flex",
						gap: 25,
						justifyContent: "center",
						marginBottom: 24,
						flexWrap: "wrap",
						alignItems: "stretch",
					}}
				>
					{sortedPlans
						? sortedPlans.map((plan) => (
								<PricingCard
									key={plan.productId}
									plan={plan}
									isPopular={plan.productId === POPULAR_PRODUCT_ID}
									onPurchase={handlePurchase}
								/>
						  ))
						: [0, 1, 2].map((i) => <PricingCardSkeleton key={i} isPopular={i === 1} />)}
				</section>

				<p
					style={{
						textAlign: "center",
						color: "#718096",
						margin: "0 0 50px 0",
						fontSize: "0.9em",
					}}
				>
					*Networks included: TikTok, Instagram, YouTube, LinkedIn, Facebook, X, Threads,
					Pinterest, Reddit, Google Business, Bluesky.
				</p>

				<section style={sectionStyle}>
					<h3 style={sectionHeadingStyle}>
						<span aria-hidden>✂️</span> Clip, Automate, and Dominate
					</h3>
					<p style={sectionParagraphStyle}>
						Stop wasting hours downloading, trimming, and re-uploading. With Extensible
						Content, you can seamlessly clip your own long-form or existing content and
						automatically schedule it across all your social media channels.
					</p>
					<p style={sectionParagraphStyle}>
						To keep your accounts safe from shadowbans and spam filters, we enforce
						recommended daily posting caps per account. Maximize your reach without risking
						your reputation:
					</p>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
							gap: 15,
							marginTop: 30,
						}}
					>
						{POSTING_LIMITS.map((row) => (
							<div
								key={row.network}
								style={{
									background: "#f8fafc",
									padding: "18px 20px",
									borderRadius: 10,
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									fontWeight: 600,
									color: "#2d3748",
									borderLeft: `4px solid ${PRIMARY}`,
								}}
							>
								<span>{row.network}</span>
								<span style={{ color: "#718096", fontSize: "0.9em", fontWeight: 400 }}>
									<span
										style={{
											color: PRIMARY_DARK,
											fontWeight: 700,
											fontSize: "1.2em",
										}}
									>
										{row.perDay}
									</span>{" "}
									/ 24h
								</span>
							</div>
						))}
					</div>
				</section>

				<section style={sectionStyle}>
					<h3 style={sectionHeadingStyle}>
						<span aria-hidden>💰</span> Monetize on Autopilot with Whop &amp; AI
					</h3>
					<p style={sectionParagraphStyle}>
						Your social media real estate is valuable. Extensible Content isn&apos;t just a
						scheduler; it&apos;s a revenue generator.
					</p>
					<p style={sectionParagraphStyle}>
						By upgrading, you unlock the ability to{" "}
						<strong>automate Whop clipping</strong> for affiliate and promotional campaigns,
						instantly monetizing your social pages with zero extra manual work.
					</p>
					<p style={sectionParagraphStyle}>
						Furthermore, you gain access to our{" "}
						<strong>AI-based cross-clipping network</strong>. Optionally you can leverage AI
						to clip and share content from other creators within the ecosystem, driving
						shared growth and entirely new revenue streams.
					</p>
				</section>

				<section style={sectionStyle}>
					<h3 style={sectionHeadingStyle}>
						<span aria-hidden>🛠️</span> Build, Share, and Get Paid
					</h3>
					<p style={sectionParagraphStyle}>
						Are you an automation wizard? Extensible Content rewards its builders. We&apos;ve
						set aside a dedicated <strong>Creator Pool</strong> to financially reward the
						community&apos;s top contributors.
					</p>
					<div
						style={{
							background: "#e8fdf2",
							border: "1px solid #bbf7d0",
							padding: 30,
							borderRadius: 12,
							marginTop: 30,
						}}
					>
						<h4 style={{ color: "#065f46", fontSize: "1.4em", margin: "0 0 15px 0" }}>
							How it works:
						</h4>
						<p style={{ ...sectionParagraphStyle, margin: 0 }}>
							Build high-performing templates or highly efficient automation workflows and
							submit them to our global library. The top submitters whose workflows are
							used by the community get paid out directly from this pool every month.
						</p>
					</div>
				</section>

				<footer
					style={{
						textAlign: "center",
						color: "#a0aec0",
						marginTop: 50,
						paddingBottom: 40,
						fontSize: "0.95em",
					}}
				>
					You can upgrade, downgrade, or cancel at any time from your billing dashboard. You
					can safely close this tab once you&apos;ve picked a plan — the extension is already
					signed in.
				</footer>
			</div>
		</div>
	);
}

const sectionStyle: React.CSSProperties = {
	background: CARD_BG,
	borderRadius: 16,
	padding: 40,
	marginBottom: 40,
	boxShadow: "0 5px 20px rgba(0,0,0,0.03)",
};

const sectionHeadingStyle: React.CSSProperties = {
	color: TEXT_DARK,
	fontSize: "1.8em",
	margin: "0 0 20px 0",
	display: "flex",
	alignItems: "center",
	gap: 12,
};

const sectionParagraphStyle: React.CSSProperties = {
	fontSize: "1.05em",
	color: TEXT_LIGHT,
	margin: "0 0 12px 0",
};

interface PricingCardProps {
	plan: PlanCheckoutResponseEntry;
	isPopular: boolean;
	onPurchase: (url: string | null) => void;
}

function PricingCard({ plan, isPopular, onPurchase }: PricingCardProps) {
	const copy = TIER_COPY[plan.productId];
	const displayName = copy?.displayName ?? plan.name;
	const buttonLabel = `Upgrade to ${displayName}`;
	const disabled = !plan.purchaseUrl;

	const cardStyle: React.CSSProperties = {
		background: CARD_BG,
		borderRadius: 16,
		padding: "40px 30px",
		flex: 1,
		minWidth: 280,
		maxWidth: 360,
		boxShadow: isPopular
			? "0 15px 35px rgba(0,0,0,0.1)"
			: "0 10px 25px rgba(0,0,0,0.05)",
		borderTop: `6px solid ${isPopular ? PRIMARY_DARK : PRIMARY}`,
		display: "flex",
		flexDirection: "column",
		position: "relative",
		transform: isPopular ? "scale(1.03)" : undefined,
	};

	return (
		<div style={cardStyle}>
			{isPopular ? (
				<span
					style={{
						position: "absolute",
						top: -15,
						left: "50%",
						transform: "translateX(-50%)",
						background: PRIMARY_DARK,
						color: "white",
						padding: "5px 15px",
						borderRadius: 20,
						fontSize: "0.8em",
						fontWeight: 700,
						textTransform: "uppercase",
						letterSpacing: 1,
						whiteSpace: "nowrap",
					}}
				>
					Most Popular
				</span>
			) : null}

			<h2 style={{ marginTop: 0, color: TEXT_DARK, fontSize: "1.8em", marginBottom: 5 }}>
				{displayName}
			</h2>
			<div
				style={{
					fontSize: "3em",
					fontWeight: 800,
					color: TEXT_DARK,
					margin: "10px 0 20px 0",
					lineHeight: 1,
				}}
			>
				{plan.priceLabel ? <PriceDisplay label={plan.priceLabel} /> : <span style={{ fontSize: "0.5em", color: "#718096", fontWeight: 500 }}>See on Whop</span>}
			</div>

			<ul
				style={{
					listStyle: "none",
					padding: 0,
					margin: "0 0 30px 0",
					flexGrow: 1,
				}}
			>
				{copy ? (
					<>
						<FeatureRow primary={copy.profilesLine.primary} secondary={copy.profilesLine.secondary} />
						<FeatureRow primary={copy.storageLine.primary} secondary={copy.storageLine.secondary} />
						<FeatureRow primary={copy.creditsLine.primary} secondary={copy.creditsLine.secondary} />
					</>
				) : (
					plan.features.map((f) => <FeatureRow key={f} primary={f} />)
				)}
			</ul>

			<button
				type="button"
				onClick={() => onPurchase(plan.purchaseUrl)}
				disabled={disabled}
				style={{
					display: "block",
					width: "100%",
					textAlign: "center",
					background: isPopular ? PRIMARY_DARK : PRIMARY,
					color: "#fff",
					textDecoration: "none",
					padding: "16px 0",
					borderRadius: 10,
					fontWeight: 700,
					fontSize: "1.05em",
					marginTop: "auto",
					boxSizing: "border-box",
					border: "none",
					cursor: disabled ? "not-allowed" : "pointer",
					opacity: disabled ? 0.6 : 1,
				}}
			>
				{disabled ? plan.error ?? "Checkout unavailable" : buttonLabel}
			</button>
		</div>
	);
}

function PriceDisplay({ label }: { label: string }) {
	const match = label.match(/^([^/]+?)\s*\/\s*(.+)$/);
	if (!match) {
		return <span>{label}</span>;
	}
	const [, amount, interval] = match;
	return (
		<>
			{amount.trim()}
			<span style={{ fontSize: "0.4em", color: "#718096", fontWeight: 500 }}>/{interval.trim()}</span>
		</>
	);
}

function FeatureRow({ primary, secondary }: { primary: string; secondary?: string }) {
	return (
		<li
			style={{
				marginBottom: 15,
				fontSize: "0.95em",
				position: "relative",
				paddingLeft: 30,
				color: TEXT_LIGHT,
			}}
		>
			<span
				aria-hidden
				style={{
					color: PRIMARY_DARK,
					position: "absolute",
					left: 0,
					fontWeight: 700,
					fontSize: "1.2em",
				}}
			>
				✔
			</span>
			<strong>{primary}</strong>
			{secondary ? (
				<>
					<br />
					<small style={{ color: "#718096" }}>({secondary})</small>
				</>
			) : null}
		</li>
	);
}

function PricingCardSkeleton({ isPopular }: { isPopular: boolean }) {
	return (
		<div
			style={{
				background: CARD_BG,
				borderRadius: 16,
				padding: "40px 30px",
				flex: 1,
				minWidth: 280,
				maxWidth: 360,
				boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
				borderTop: `6px solid ${isPopular ? PRIMARY_DARK : PRIMARY}`,
				display: "flex",
				flexDirection: "column",
				gap: 16,
				transform: isPopular ? "scale(1.03)" : undefined,
			}}
		>
			<div style={{ height: 24, background: "#edf2f7", borderRadius: 6, width: "50%" }} />
			<div style={{ height: 48, background: "#edf2f7", borderRadius: 6, width: "70%" }} />
			<div style={{ height: 14, background: "#edf2f7", borderRadius: 6 }} />
			<div style={{ height: 14, background: "#edf2f7", borderRadius: 6 }} />
			<div style={{ height: 14, background: "#edf2f7", borderRadius: 6, width: "80%" }} />
			<div style={{ height: 48, background: "#edf2f7", borderRadius: 10, marginTop: "auto" }} />
		</div>
	);
}
