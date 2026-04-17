"use client";

import { useState } from "react";
import { useIframeSdk } from "@whop/react";
import type { PlanTier } from "@/lib/plan-tiers";

export interface UpgradePickerOption {
	tier: Pick<PlanTier, "productId" | "name" | "tagline" | "features" | "rank" | "maxUploadPostAccounts" | "shotstackCreditsPerPeriod">;
	purchaseUrl: string | null;
	priceLabel: string | null;
	error?: string;
}

export interface UpgradePickerProps {
	options: UpgradePickerOption[];
	currentProductId: string | null;
	triggerLabel?: string;
	className?: string;
	/** Heading shown above the picker once expanded. */
	title?: string;
}

/**
 * Three-tier plan picker. Each tier opens its Whop-hosted checkout URL via
 * the Whop iframe SDK (`openExternalUrl`) so it works seamlessly inside the
 * embedded experience iframe and falls back to a plain anchor when the iframe
 * SDK isn't available (e.g. opened directly in a tab).
 */
export function UpgradePicker({
	options,
	currentProductId,
	triggerLabel = "Upgrade",
	className,
	title = "Choose a plan",
}: UpgradePickerProps) {
	const [open, setOpen] = useState(false);
	// `WhopApp` (mounted in app/layout.tsx) wraps the tree with
	// `WhopIframeSdkProvider`, so this is always available — but the SDK
	// only succeeds at routing the URL when the app is actually inside the
	// Whop iframe. Outside of it (e.g. the extension login page), the call
	// no-ops and we fall back to opening the link in a new tab below.
	const iframeSdk = useIframeSdk();

	const handlePurchase = (url: string | null) => {
		if (!url) return;
		try {
			iframeSdk.openExternalUrl({ url });
			return;
		} catch {
			// Not running inside the Whop iframe; open in a new tab instead.
		}
		window.open(url, "_blank", "noopener,noreferrer");
	};

	return (
		<div className={className}>
			{!open ? (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90"
				>
					{triggerLabel}
				</button>
			) : (
				<div className="border border-gray-a4 rounded-lg p-4 bg-gray-a2 flex flex-col gap-4">
					<div className="flex items-center justify-between gap-3">
						<p className="text-4 font-semibold text-gray-12">{title}</p>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="text-2 text-gray-10 underline hover:no-underline"
						>
							Hide
						</button>
					</div>
					<ul className="grid gap-3 md:grid-cols-3">
						{options.map((opt) => {
							const isCurrent = currentProductId === opt.tier.productId;
							return (
								<li
									key={opt.tier.productId}
									className={`flex flex-col gap-3 border rounded-lg p-3 bg-gray-a1 ${
										isCurrent ? "border-green-a7" : "border-gray-a4"
									}`}
								>
									<div>
										<div className="flex items-center justify-between gap-2">
											<p className="text-4 font-semibold text-gray-12">{opt.tier.name}</p>
											{isCurrent ? (
												<span className="text-2 px-2 py-0.5 rounded-md bg-green-a3 text-green-11">Current</span>
											) : null}
										</div>
										{opt.priceLabel ? (
											<p className="text-3 text-gray-12 mt-1">{opt.priceLabel}</p>
										) : (
											<p className="text-2 text-gray-10 mt-1">Pricing on Whop</p>
										)}
										<p className="text-2 text-gray-10 mt-1">{opt.tier.tagline}</p>
									</div>

									<ul className="text-2 text-gray-11 flex flex-col gap-1 list-disc pl-4">
										{opt.tier.features.map((f) => (
											<li key={f}>{f}</li>
										))}
									</ul>

									<div className="mt-auto">
										{opt.purchaseUrl ? (
											<button
												type="button"
												onClick={() => handlePurchase(opt.purchaseUrl)}
												className="w-full text-3 px-3 py-2 rounded-md bg-gray-12 text-gray-1 hover:opacity-90"
											>
												{isCurrent ? "Manage on Whop" : "Choose"}
											</button>
										) : (
											<p className="text-2 text-red-11">{opt.error ?? "Checkout unavailable"}</p>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}
