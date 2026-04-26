import type { NextRequest } from "next/server";
import { decryptSsoPayload } from "@/lib/ghl-sso";

/**
 * POST /api/ghl/sso
 *
 * Decrypts the AES-256-CBC encrypted SSO payload sent by the GHL parent
 * iframe via postMessage. Returns the decrypted user context including
 * activeLocation, companyId, userId, etc.
 *
 * Body: { payload: string } -- the base64-encoded encrypted payload from GHL
 */
export async function POST(request: NextRequest) {
	let body: { payload: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { payload } = body;
	if (!payload) {
		return Response.json({ error: "payload is required" }, { status: 400 });
	}

	const sharedSecret = process.env.GHL_SHARED_SECRET;
	if (!sharedSecret) {
		return Response.json({ error: "SSO not configured" }, { status: 500 });
	}

	try {
		const decrypted = decryptSsoPayload(payload, sharedSecret);
		return Response.json(decrypted);
	} catch (err) {
		console.error("[ghl-sso] Decryption failed:", err);
		return Response.json(
			{ error: "Failed to decrypt SSO payload" },
			{ status: 400 },
		);
	}
}
