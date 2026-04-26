import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Decrypted SSO payload GHL sends to embedded custom pages.
 * Fields present depend on the GHL context (agency vs. location).
 */
export interface GhlSsoContext {
	userId?: string;
	companyId?: string;
	activeLocation?: string;
	role?: string;
	type?: string;
	userName?: string;
	email?: string;
	[key: string]: unknown;
}

/**
 * Decrypt the AES-256-CBC "Salted__" payload GHL sends to embedded custom
 * pages via postMessage. Only a true GHL iframe instance can produce a valid
 * payload (it's signed/encrypted with the shared secret from the marketplace
 * app), so a successful decryption authenticates the caller as an authorized
 * GHL user of the location in the payload.
 */
export function decryptSsoPayload(
	base64Payload: string,
	password: string,
): GhlSsoContext {
	const encryptedBuffer = Buffer.from(base64Payload, "base64");

	// OpenSSL "Salted__" format: first 8 bytes = "Salted__", next 8 = salt.
	const header = encryptedBuffer.subarray(0, 8).toString("utf8");
	if (header !== "Salted__") {
		throw new Error("Invalid encrypted payload: missing Salted__ header");
	}

	const salt = encryptedBuffer.subarray(8, 16);
	const encrypted = encryptedBuffer.subarray(16);

	const { key, iv } = evpBytesToKey(password, salt, 32, 16);

	const decipher = createDecipheriv("aes-256-cbc", key, iv);
	const decrypted = Buffer.concat([
		decipher.update(encrypted),
		decipher.final(),
	]);

	return JSON.parse(decrypted.toString("utf8")) as GhlSsoContext;
}

/**
 * OpenSSL EVP_BytesToKey (MD5-based). Matches `openssl enc -aes-256-cbc`.
 */
function evpBytesToKey(
	password: string,
	salt: Buffer,
	keyLen: number,
	ivLen: number,
): { key: Buffer; iv: Buffer } {
	const totalLen = keyLen + ivLen;
	const result: Buffer[] = [];
	let lastHash: Buffer = Buffer.alloc(0);
	let totalBytes = 0;

	while (totalBytes < totalLen) {
		const h = createHash("md5");
		if (lastHash.length > 0) h.update(lastHash);
		h.update(password, "utf8");
		h.update(salt);
		lastHash = h.digest();
		result.push(lastHash);
		totalBytes += lastHash.length;
	}

	const combined = Buffer.concat(result);
	return {
		key: combined.subarray(0, keyLen),
		iv: combined.subarray(keyLen, keyLen + ivLen),
	};
}

/**
 * Verify a GHL SSO payload and return the decrypted context. Returns null if
 * the shared secret is missing or decryption fails.
 */
export function verifyGhlSso(payload: string | null | undefined): GhlSsoContext | null {
	if (!payload) return null;
	const secret = process.env.GHL_SHARED_SECRET;
	if (!secret) return null;
	try {
		return decryptSsoPayload(payload, secret);
	} catch {
		return null;
	}
}

/**
 * HMAC-sign an arbitrary JSON-serializable object to carry through an OAuth
 * `state` round-trip. Keyed on GHL_SHARED_SECRET so we don't need an extra
 * env var. Format: base64url(json).base64url(hmac-sha256).
 */
export function signState(data: unknown): string {
	const secret = process.env.GHL_SHARED_SECRET;
	if (!secret) throw new Error("GHL_SHARED_SECRET is required");
	const json = JSON.stringify(data);
	const payload = Buffer.from(json).toString("base64url");
	const sig = createHmac("sha256", secret).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

/**
 * Verify an HMAC-signed state string and return the decoded object. Returns
 * null on any mismatch (bad signature, missing secret, malformed payload).
 */
export function verifyState<T = unknown>(signed: string | null | undefined): T | null {
	if (!signed) return null;
	const secret = process.env.GHL_SHARED_SECRET;
	if (!secret) return null;
	const [payload, sig] = signed.split(".");
	if (!payload || !sig) return null;
	const expected = createHmac("sha256", secret).update(payload).digest("base64url");
	const sigBuf = Buffer.from(sig, "base64url");
	const expectedBuf = Buffer.from(expected, "base64url");
	if (sigBuf.length !== expectedBuf.length) return null;
	try {
		if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
	} catch {
		return null;
	}
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
	} catch {
		return null;
	}
}

/**
 * Name of the HTTP-only cookie we set on OAuth callback to remember which
 * Whop user is "active" in this browser. Signed with GHL_SHARED_SECRET so it
 * cannot be forged client-side.
 */
export const WHOP_USER_COOKIE = "ec_whop_user";

/** 30 days. */
export const WHOP_USER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type WhopUserCookiePayload = {
	userId: string;
	/** Epoch ms at which this cookie should be considered expired. */
	exp: number;
};

/**
 * Sign the Whop user id into a string suitable for a cookie value.
 */
export function signWhopUserCookie(userId: string): string {
	return signState({
		userId,
		exp: Date.now() + WHOP_USER_COOKIE_MAX_AGE * 1000,
	} satisfies WhopUserCookiePayload);
}

/**
 * Verify and extract the Whop user id from a cookie value. Returns null if
 * the signature is invalid, the cookie is missing, or it has expired.
 */
export function readWhopUserCookie(
	value: string | null | undefined,
): string | null {
	const data = verifyState<WhopUserCookiePayload>(value);
	if (!data || !data.userId) return null;
	if (data.exp && Date.now() > data.exp) return null;
	return data.userId;
}

/**
 * Serialize a `Set-Cookie` header value for the Whop user cookie.
 *
 * The cookie is set `SameSite=None; Secure` because this app is embedded in a
 * GHL iframe served from a different origin, and cookies must be allowed in
 * cross-site iframe contexts. `HttpOnly` prevents client-side JS from reading
 * the signed value — the browser still sends it on fetches to our API.
 */
export function serializeWhopUserCookie(
	value: string,
	options: { maxAge?: number } = {},
): string {
	const maxAge = options.maxAge ?? WHOP_USER_COOKIE_MAX_AGE;
	const parts = [
		`${WHOP_USER_COOKIE}=${value}`,
		"Path=/",
		"HttpOnly",
		"Secure",
		"SameSite=None",
		`Max-Age=${maxAge}`,
	];
	return parts.join("; ");
}

/**
 * `Set-Cookie` header value to clear the Whop user cookie.
 */
export function clearWhopUserCookieHeader(): string {
	return serializeWhopUserCookie("", { maxAge: 0 });
}
