import { waitUntil } from "@vercel/functions";
import type { NextRequest } from "next/server";
import { handleMembershipChanged, handlePaymentSucceeded } from "@/lib/whop-payment-handler";
import { whopsdk } from "@/lib/whop-sdk";

export async function POST(request: NextRequest): Promise<Response> {
	const requestBodyText = await request.text();
	const headers = Object.fromEntries(request.headers);
	const webhookData = whopsdk.webhooks.unwrap(requestBodyText, { headers });

	switch (webhookData.type) {
		case "payment.succeeded":
			// Funds the period: credits the ledger + syncs `users.max_upload_post_accounts`.
			waitUntil(handlePaymentSucceeded(webhookData.data));
			break;
		case "membership.activated":
		case "membership.deactivated":
			// No credits (those follow payments) but the cached entitlement
			// flags need to flip so the dashboard reflects the change.
			waitUntil(handleMembershipChanged(webhookData.data.user?.id ?? null));
			break;
		default:
			break;
	}

	// 2xx fast — Whop retries any non-2xx and our handlers run on `waitUntil`.
	return new Response("OK", { status: 200 });
}
