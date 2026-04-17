import { UpgradePicker, type UpgradePickerOption } from "@/components/upgrade-picker";
import { requireExperienceContext } from "@/lib/experience-context";
import { getTierCheckouts } from "@/lib/plan-checkout-urls";
import { listActivePlanMemberships } from "@/lib/plan-entitlements";
import { pickHighestTier } from "@/lib/plan-tiers";
import { getServiceSupabase } from "@/lib/supabase-service";
import { countUploadPostAccountsForUser } from "@/lib/upload-post-account-limits";
import { AddAccountForm, CloudUploadForm, ConnectUrlForm } from "./upload-post-client";

function formatPriceLabel(plan: { initialPrice: number | null; currency: string | null; billingPeriod: number | null; planType: string | null }): string | null {
	if (plan.initialPrice == null) return null;
	const price = plan.initialPrice.toLocaleString(undefined, {
		style: "currency",
		currency: (plan.currency ?? "USD").toUpperCase(),
		maximumFractionDigits: 2,
	});
	if (plan.planType === "renewal") {
		const days = plan.billingPeriod ?? 30;
		const interval =
			days === 30 ? "month" : days === 365 ? "year" : days === 7 ? "week" : `${days} days`;
		return `${price} / ${interval}`;
	}
	return `${price} one-time`;
}

export default async function UploadPostPage({ params }: { params: Promise<{ experienceId: string }> }) {
	const { experienceId } = await params;
	const { internalUserId, whopUserId } = await requireExperienceContext(experienceId);
	const supabase = getServiceSupabase();

	const [{ data: accounts, error }, { data: userRow }, count, tierCheckouts, activeMemberships] = await Promise.all([
		supabase
			.from("upload_post_accounts")
			.select("id, name, upload_post_username, uses_own_key, created_at, updated_at, jwt_access_url, jwt_expires_at")
			.eq("user_id", internalUserId)
			.order("created_at", { ascending: false }),
		supabase.from("users").select("max_upload_post_accounts, has_upgraded").eq("id", internalUserId).maybeSingle(),
		countUploadPostAccountsForUser(supabase, internalUserId),
		getTierCheckouts(),
		listActivePlanMemberships(whopUserId),
	]);

	if (error) {
		return <p className="text-3 text-red-11">Could not load Upload-Post accounts.</p>;
	}

	const list = accounts ?? [];
	const maxAccounts = (userRow?.max_upload_post_accounts as number | null) ?? 0;
	const hasUpgraded = !!userRow?.has_upgraded;
	const remaining = Math.max(0, maxAccounts - count);
	const atLimit = maxAccounts > 0 && count >= maxAccounts;
	const featureDisabled = maxAccounts <= 0;

	const currentTier = pickHighestTier(activeMemberships.map((m) => m.tier));
	const upgradeOptions: UpgradePickerOption[] = tierCheckouts.map((tc) => ({
		tier: tc.tier,
		purchaseUrl: tc.plan?.purchaseUrl ?? null,
		priceLabel: tc.plan ? formatPriceLabel(tc.plan) : null,
		error: tc.error,
	}));
	const upgradeAvailable = upgradeOptions.some((o) => o.purchaseUrl);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-6 font-bold text-gray-12">Upload Post</h2>
				<p className="text-3 text-gray-10 mt-1 max-w-2xl">
					Connected profiles for posting to social platforms via{" "}
					<a href="https://upload-post.com" className="underline text-gray-12" target="_blank" rel="noreferrer">
						Upload-Post
					</a>
					. Managed-key accounts can use the cloud proxy from this page; BYOK accounts must post with your own API key
					from the extension.
				</p>
			</div>

			<section className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-col">
						<p className="text-2 text-gray-10 uppercase tracking-wide">Account usage</p>
						<p className="text-5 font-semibold text-gray-12 mt-1">
							{count} <span className="text-gray-10">/</span> {featureDisabled ? "0" : maxAccounts}{" "}
							<span className="text-3 font-normal text-gray-10">used</span>
						</p>
						<p className="text-2 text-gray-10 mt-1">
							{featureDisabled
								? "Upload-Post accounts aren't included in your current plan."
								: atLimit
									? "You've reached your account limit. Upgrade to add more."
									: `${remaining} more ${remaining === 1 ? "account" : "accounts"} available on your current plan.`}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<span
							className={`text-2 px-2 py-1 rounded-md ${hasUpgraded ? "bg-green-a3 text-green-11" : "bg-gray-a3 text-gray-11"}`}
						>
							{currentTier ? currentTier.name : hasUpgraded ? "Pro" : "Free"}
						</span>
						{upgradeAvailable ? (
							<UpgradePicker
								options={upgradeOptions}
								currentProductId={currentTier?.productId ?? null}
								triggerLabel={currentTier ? "Change plan" : "Upgrade"}
								title={currentTier ? "Change your plan" : "Choose a plan"}
							/>
						) : (
							<span className="text-2 text-gray-10" title="Set WHOP_COMPANY_ID and configure plans on Whop">
								Upgrade unavailable
							</span>
						)}
					</div>
				</div>
			</section>

			<AddAccountForm
				experienceId={experienceId}
				disabled={featureDisabled || atLimit}
				disabledReason={
					featureDisabled
						? "Upload-Post accounts aren't enabled on your plan. Upgrade to add one."
						: atLimit
							? `You're using ${count} of ${maxAccounts} accounts. Upgrade to add more.`
							: undefined
				}
			/>

			{list.length === 0 ? (
				<p className="text-3 text-gray-10 border border-gray-a4 rounded-lg p-6 bg-gray-a2">
					No accounts yet. Add one above, or POST{" "}
					<code className="text-2 bg-gray-a3 px-1 rounded">/api/extension/upload-post-accounts</code> from the
					extension.
				</p>
			) : (
				<ul className="flex flex-col gap-6">
					{list.map((acc) => (
						<li key={acc.id} className="border border-gray-a4 rounded-lg p-4 bg-gray-a2">
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<div>
									<p className="text-5 font-semibold text-gray-12">{acc.name}</p>
									<p className="text-2 text-gray-10 font-mono mt-1">{acc.upload_post_username}</p>
									<p className="text-2 text-gray-10 mt-1">
										{acc.uses_own_key ? "BYOK — use extension for API calls" : "Managed key — cloud proxy available"}
									</p>
								</div>
							</div>

							<div className="mt-3 border-t border-gray-a4 pt-3">
								<p className="text-3 font-medium text-gray-12">Connect social accounts</p>
								<p className="text-2 text-gray-10 mt-1">
									Opens Upload-Post&apos;s hosted connect flow (JWT cached on the server like the extension).
								</p>
								<ConnectUrlForm experienceId={experienceId} accountId={acc.id} />
							</div>

							{!acc.uses_own_key ? (
								<div className="mt-4 border-t border-gray-a4 pt-3">
									<p className="text-3 font-medium text-gray-12">Cloud post (photo)</p>
									<p className="text-2 text-gray-10 mt-1">
										Forwards to Upload-Post via{" "}
										<code className="text-2 bg-gray-a3 px-1 rounded">/api/extension/upload-post/proxy</code> with your
										account.
									</p>
									<CloudUploadForm experienceId={experienceId} accountId={acc.id} />
								</div>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
