import type { NextRequest } from "next/server";
import { createDecipheriv } from "crypto";

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

/**
 * Decrypt GHL SSO payload.
 * GHL uses OpenSSL-compatible AES-256-CBC with a "Salted__" header.
 * The password is the Shared Secret Key from the marketplace app.
 */
function decryptSsoPayload(
	base64Payload: string,
	password: string,
): Record<string, unknown> {
	const encryptedBuffer = Buffer.from(base64Payload, "base64");

	// OpenSSL "Salted__" format: first 8 bytes = "Salted__", next 8 = salt
	const header = encryptedBuffer.subarray(0, 8).toString("utf8");
	if (header !== "Salted__") {
		throw new Error("Invalid encrypted payload: missing Salted__ header");
	}

	const salt = encryptedBuffer.subarray(8, 16);
	const encrypted = encryptedBuffer.subarray(16);

	// Derive key and IV using OpenSSL's EVP_BytesToKey (MD5-based)
	const { key, iv } = evpBytesToKey(password, salt, 32, 16);

	const decipher = createDecipheriv("aes-256-cbc", key, iv);
	const decrypted = Buffer.concat([
		decipher.update(encrypted),
		decipher.final(),
	]);

	return JSON.parse(decrypted.toString("utf8"));
}

/**
 * OpenSSL EVP_BytesToKey key derivation (MD5-based).
 * Matches OpenSSL's default for "openssl enc -aes-256-cbc".
 */
function evpBytesToKey(
	password: string,
	salt: Buffer,
	keyLen: number,
	ivLen: number,
): { key: Buffer<ArrayBuffer>; iv: Buffer<ArrayBuffer> } {
	const { createHash } = require("crypto") as typeof import("crypto");
	const totalLen = keyLen + ivLen;
	const result: Buffer<ArrayBuffer>[] = [];
	let lastHash: Buffer<ArrayBuffer> = Buffer.alloc(0);
	let totalBytes = 0;

	while (totalBytes < totalLen) {
		const h = createHash("md5");
		if (lastHash.length > 0) h.update(lastHash);
		h.update(password, "utf8");
		h.update(salt);
		lastHash = h.digest() as Buffer<ArrayBuffer>;
		result.push(lastHash);
		totalBytes += lastHash.length;
	}

	const combined = Buffer.concat(result);
	return {
		key: combined.subarray(0, keyLen) as Buffer<ArrayBuffer>,
		iv: combined.subarray(keyLen, keyLen + ivLen) as Buffer<ArrayBuffer>,
	};
}
