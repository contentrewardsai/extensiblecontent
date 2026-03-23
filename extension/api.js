/**
 * Host API helpers for the extension (pro / Connected limits, social-profiles).
 * Load after config.js in extension pages: <script src="config.js"></script><script src="api.js"></script>
 */
(function ExtensionApiFactory(global) {
	"use strict";

	function getAppOrigin() {
		if (typeof APP_ORIGIN !== "undefined") return APP_ORIGIN;
		return "http://localhost:3000";
	}

	function getAccessToken() {
		return new Promise((resolve) => {
			if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
				resolve(null);
				return;
			}
			chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (response) => {
				if (chrome.runtime.lastError) {
					resolve(null);
					return;
				}
				resolve(response?.token ?? null);
			});
		});
	}

	async function safeApiFetch(path, options) {
		const opts = options || {};
		const token = await getAccessToken();
		const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
		if (token) headers.Authorization = "Bearer " + token;
		const res = await fetch(getAppOrigin() + path, { ...opts, headers });
		const text = await res.text();
		let body = null;
		try {
			body = text ? JSON.parse(text) : null;
		} catch {
			body = { raw: text };
		}
		const base = body && typeof body === "object" && !Array.isArray(body) ? body : {};
		if (!res.ok) {
			return Object.assign({ ok: false, status: res.status }, base);
		}
		return Object.assign({ ok: true }, base);
	}

	/**
	 * Returns full JSON from has-upgraded (including num_accounts / max_accounts) plus ok + pro.
	 * On 404 (endpoint missing), treat as free tier with no slots for safe local fallback.
	 */
	async function hasUpgraded() {
		const res = await safeApiFetch("/api/extension/has-upgraded");
		if (!res.ok) {
			if (res.status === 404) {
				return {
					ok: true,
					pro: false,
					has_upgraded: false,
					num_accounts: 0,
					max_accounts: 0,
				};
			}
			return res;
		}
		const pro = res.pro != null ? res.pro : res.has_upgraded;
		return Object.assign({}, res, { ok: true, pro: !!pro });
	}

	/**
	 * Client-side gate before POST or before appending to chrome.storage on offline fallback.
	 * @param {number} profilesLength
	 * @param {number} maxAccounts from hasUpgraded().max_accounts
	 */
	function canAddConnectedProfile(profilesLength, maxAccounts) {
		const max = Number(maxAccounts);
		if (!Number.isFinite(max) || max <= 0) {
			return { allowed: false, reason: "no_slots" };
		}
		if (profilesLength >= max) {
			return { allowed: false, reason: "at_limit" };
		}
		return { allowed: true };
	}

	/**
	 * @param {unknown[]} existing
	 * @param {unknown} newProfile
	 * @param {number} maxAccounts
	 * @returns {unknown[]} copy of existing, with newProfile appended only if under cap
	 */
	function appendConnectedProfileIfUnderCap(existing, newProfile, maxAccounts) {
		const list = Array.isArray(existing) ? existing.slice() : [];
		const gate = canAddConnectedProfile(list.length, maxAccounts);
		if (!gate.allowed) return list;
		list.push(newProfile);
		return list;
	}

	/**
	 * POST /api/extension/social-profiles only if under limit (re-check on Save to reduce races).
	 * @param {number} profilesLength current list length
	 * @param {number} maxAccounts from last hasUpgraded() (or 0 if unknown)
	 * @param {Record<string, unknown>} body e.g. { name }
	 */
	async function addSocialProfileIfAllowed(profilesLength, maxAccounts, body) {
		const gate = canAddConnectedProfile(profilesLength, maxAccounts);
		if (!gate.allowed) {
			return {
				ok: false,
				status: 403,
				error:
					gate.reason === "at_limit"
						? "Maximum accounts reached. Upgrade to add more."
						: "Upload-Post accounts are not available for your plan.",
			};
		}
		return safeApiFetch("/api/extension/social-profiles", {
			method: "POST",
			body: JSON.stringify(body || {}),
		});
	}

	global.ExtensionApi = {
		getAppOrigin,
		getAccessToken,
		safeApiFetch,
		hasUpgraded,
		canAddConnectedProfile,
		appendConnectedProfileIfUnderCap,
		addSocialProfileIfAllowed,
	};
})(typeof globalThis !== "undefined" ? globalThis : this);
