import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
	title: "Content Rewards AI - Scale Your Clipping Campaigns",
	description:
		"Stop overpaying for ads. Content Rewards AI automates your clipping campaigns, tracks millions of views, and handles payouts instantly.",
};

export default function ContentRewardsAIPage() {
	return (
		<div className="cra-page">
			{/* ── Nav ───────────────────────────────────────────────── */}
			<nav className="cra-nav">
				<a href="/" className="cra-nav-brand">
					Content Rewards AI
				</a>
				<ul className="cra-nav-links">
					<li>
						<a href="#features">Features</a>
					</li>
					<li>
						<a href="#why-clipping">Why Clipping?</a>
					</li>
					<li>
						<a href="#seo">SEO Power</a>
					</li>
					<li>
						<a href="#pricing">Pricing</a>
					</li>
					<li>
						<a
							href="https://whop.com/content-rewards-ai/"
							target="_blank"
							rel="noopener noreferrer"
							className="cra-nav-cta"
						>
							Install on Whop
						</a>
					</li>
				</ul>
			</nav>

			{/* ── Hero ──────────────────────────────────────────────── */}
			<section className="cra-hero">
				<div className="cra-hero-badge">
					Coming Soon to the Whop App Marketplace
				</div>
				<h1>
					Turn Your Fans Into <span>Viral Marketers</span>
				</h1>
				<p>
					Stop overpaying for ads. Content Rewards AI automates your
					clipping campaigns, tracks millions of views, and handles
					payouts instantly.
				</p>
				<div className="cra-hero-actions">
					<a
						href="https://whop.com/content-rewards-ai/"
						target="_blank"
						rel="noopener noreferrer"
						className="cra-btn-primary"
					>
						Start Your Campaign
					</a>
					<a href="#features" className="cra-btn-outline">
						See How It Works
					</a>
				</div>
			</section>

			{/* ── Why Clipping? (Comparison) ────────────────────────── */}
			<section
				id="why-clipping"
				className="cra-section cra-section-center"
			>
				<h2>Why Pay Big Tech When You Can Pay Your Community?</h2>
				<p>
					Traditional ads are getting more expensive every day.
					Clipping campaigns are the arbitrage opportunity of the
					decade.
				</p>

				<div className="cra-comparison">
					<div className="cra-compare-card">
						<h3>Traditional Ads</h3>
						<ul>
							<li>
								Expensive CPMs ($25&ndash;$100+ per 1k views)
							</li>
							<li>Look like ads (people scroll past)</li>
							<li>Zero SEO benefit</li>
							<li>
								Builds platform wealth, not community loyalty
							</li>
						</ul>
					</div>
					<div className="cra-compare-card cra-winner">
						<div className="cra-winner-badge">Winner</div>
						<h3>Content Rewards AI</h3>
						<ul>
							<li>
								Ultra-low CPM (often less than $1.00 per 1k
								views)
							</li>
							<li>
								Organic reach (TikTok / Reels algorithm love)
							</li>
							<li>Massive social proof &amp; SEO dominance</li>
							<li>You only pay for results (actual views)</li>
						</ul>
					</div>
				</div>
			</section>

			{/* ── Features ──────────────────────────────────────────── */}
			<section id="features" className="cra-section cra-section-center">
				<span className="cra-section-label">Features</span>
				<h2>Complete Command Center for Viral Growth</h2>
				<p>
					Everything you need to manage an army of clippers without
					the headache.
				</p>

				<div className="cra-features">
					<div className="cra-feature-card">
						<div className="cra-feature-icon">📋</div>
						<h3>Smart Submission Review</h3>
						<p>
							Clippers submit their links directly in the app.
							Review content, verify quality, and reject
							low-effort posts with a single click.
						</p>
					</div>
					<div className="cra-feature-card">
						<div className="cra-feature-icon">📊</div>
						<h3>Automated View Tracking</h3>
						<p>
							Stop asking for screenshots. Our system
							automatically tracks view counts on submitted
							TikToks, Shorts, and Reels to calculate payouts.
						</p>
					</div>
					<div className="cra-feature-card">
						<div className="cra-feature-icon">💰</div>
						<h3>Flexible Payouts</h3>
						<p>
							Pay your top performers manually or on a schedule.
							Set your own RPM (Rate Per Mille) to control your
							budget while incentivizing virality.
						</p>
					</div>
				</div>
			</section>

			{/* ── SEO Power ─────────────────────────────────────────── */}
			<section id="seo" className="cra-section cra-section-center">
				<span className="cra-section-label">The Hidden Benefit</span>
				<h2>Dominate Search Results &amp; Boost AI SEO</h2>
				<p>
					When hundreds of unique profiles post content about your
					brand, you don&rsquo;t just get views&mdash;you create a
					digital footprint that search engines cannot ignore.
				</p>

				<div className="cra-seo-grid">
					<div className="cra-seo-card">
						<h3>Own the SERPs</h3>
						<p>
							Your brand name will be flooded with video results
							across Google, YouTube, and TikTok search, pushing
							down competitors.
						</p>
					</div>
					<div className="cra-seo-card">
						<h3>AI Overview Optimization</h3>
						<p>
							AI models scrape social signals. A massive clipping
							campaign teaches AI that your brand is the authority
							in your niche.
						</p>
					</div>
					<div className="cra-seo-card">
						<h3>Instant Credibility</h3>
						<p>
							Customers trust brands they see &ldquo;everywhere.&rdquo;
							Clipping campaigns manufacture the
							&ldquo;everyone is talking about this&rdquo; effect.
						</p>
					</div>
				</div>
			</section>

			{/* ── Pricing ───────────────────────────────────────────── */}
			<section id="pricing" className="cra-section cra-section-center">
				<span className="cra-section-label">Pricing</span>
				<h2>Simple, Transparent Pricing</h2>
				<p>
					We only make money when you successfully payout your
					clippers.
				</p>

				<div className="cra-pricing-card">
					<p className="cra-pricing-amount">3% or $3</p>
					<p className="cra-pricing-sub">
						Whichever is greater per transaction
					</p>

					<ul className="cra-pricing-perks">
						<li>No monthly subscription</li>
						<li>Unlimited clippers</li>
						<li>Unlimited submissions</li>
						<li>Secure payments via Stripe</li>
					</ul>

					<a
						href="https://whop.com/content-rewards-ai/"
						target="_blank"
						rel="noopener noreferrer"
						className="cra-btn-primary"
					>
						Install Now on Whop
					</a>
					<p className="cra-pricing-note">
						Requires a Whop.com account to install.
					</p>
				</div>
			</section>

			{/* ── Footer ────────────────────────────────────────────── */}
			<footer className="cra-footer">
				<div className="cra-footer-inner">
					<div>
						<p className="cra-footer-brand">Content Rewards AI</p>
						<p className="cra-footer-tagline">
							The #1 Whop App for managing content clipping
							campaigns. Scale your reach, automate payouts, and
							dominate social media.
						</p>
					</div>
					<div className="cra-footer-cols">
						<div className="cra-footer-col">
							<h4>Product</h4>
							<ul>
								<li>
									<a href="#features">Features</a>
								</li>
								<li>
									<a href="#pricing">Pricing</a>
								</li>
								<li>
									<a
										href="https://whop.com/content-rewards-ai/"
										target="_blank"
										rel="noopener noreferrer"
									>
										Install App
									</a>
								</li>
							</ul>
						</div>
						<div className="cra-footer-col">
							<h4>Legal</h4>
							<ul>
								<li>
									<a href="/privacy">Privacy Policy</a>
								</li>
								<li>
									<a href="/terms">Terms of Service</a>
								</li>
								<li>
									<a href="mailto:support@contentrewardsai.com">
										Contact Support
									</a>
								</li>
							</ul>
						</div>
					</div>
				</div>
				<p className="cra-footer-copy">
					&copy; {new Date().getFullYear()} Content Rewards AI LLC.
					All rights reserved.
				</p>
			</footer>
		</div>
	);
}
