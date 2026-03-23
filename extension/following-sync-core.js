/**
 * Following merge + normalization for extension sync.
 * Load before sidepanel/sidepanel.js (script order) or require from Node tests.
 */
(function followingSyncCoreFactory(global) {
	"use strict";

	function isNonEmptyScalar(v) {
		if (v == null) return false;
		if (typeof v === "string") return v.trim() !== "";
		return true;
	}

	function baselineScalars(online, local) {
		const o = online || {};
		const l = local || {};
		return {
			name: isNonEmptyScalar(o.name) ? o.name : l.name,
			user: isNonEmptyScalar(o.user) ? o.user : l.user,
			birthday: isNonEmptyScalar(o.birthday) ? o.birthday : l.birthday,
		};
	}

	function preferLocalScalars(online, local) {
		const o = online || {};
		const l = local || {};
		return {
			name: isNonEmptyScalar(l.name) ? l.name : isNonEmptyScalar(o.name) ? o.name : l.name,
			user: isNonEmptyScalar(l.user) ? l.user : isNonEmptyScalar(o.user) ? o.user : l.user,
			birthday: isNonEmptyScalar(l.birthday) ? l.birthday : isNonEmptyScalar(o.birthday) ? o.birthday : l.birthday,
		};
	}

	function serverScalars(online) {
		const o = online || {};
		return {
			name: o.name,
			user: o.user,
			birthday: o.birthday,
		};
	}

	function accountKey(a) {
		const pid = a.platform_id || a.platformId || "";
		const h = (a.handle || "").trim().toLowerCase();
		const u = (a.url || "").trim().toLowerCase();
		return `a:${pid}|${h}|${u}`;
	}

	function phoneKey(p) {
		return `p:${(p.phone_number || p.phoneNumber || "").trim()}`;
	}

	function emailKey(e) {
		return `e:${(e.email || "").trim().toLowerCase()}`;
	}

	function addressKey(a) {
		const parts = [
			a.address,
			a.address_2 || a.address2,
			a.city,
			a.state,
			a.zip,
			a.country,
		]
			.map((x) => (x == null ? "" : String(x).trim().toLowerCase()))
			.join("|");
		return `addr:${parts}`;
	}

	function noteKey(n) {
		if (n.id) return `n:id:${n.id}`;
		const t = (n.note || "").trim();
		const s = n.scheduled == null ? "" : String(n.scheduled);
		const acc = n.access == null ? "" : String(n.access);
		return `n:${t}|${s}|${acc}`;
	}

	function unionDedup(onlineArr, localArr, keyFn) {
		const seen = new Set();
		const out = [];
		for (const row of [...(onlineArr || []), ...(localArr || [])]) {
			const k = keyFn(row);
			if (seen.has(k)) continue;
			seen.add(k);
			out.push({ ...row });
		}
		return out;
	}

	function unionChildren(online, local) {
		return {
			accounts: unionDedup(online.accounts, local.accounts, accountKey),
			phones: unionDedup(online.phones, local.phones, phoneKey),
			emails: unionDedup(online.emails, local.emails, emailKey),
			addresses: unionDedup(online.addresses, local.addresses, addressKey),
			notes: unionDedup(online.notes, local.notes, noteKey),
		};
	}

	function serverChildren(online) {
		return {
			accounts: [...(online.accounts || [])].map((x) => ({ ...x })),
			phones: [...(online.phones || [])].map((x) => ({ ...x })),
			emails: [...(online.emails || [])].map((x) => ({ ...x })),
			addresses: [...(online.addresses || [])].map((x) => ({ ...x })),
			notes: [...(online.notes || [])].map((x) => ({ ...x })),
		};
	}

	function childKeySets(online, local) {
		return {
			accounts: {
				on: new Set((online.accounts || []).map(accountKey)),
				loc: new Set((local.accounts || []).map(accountKey)),
			},
			phones: {
				on: new Set((online.phones || []).map(phoneKey)),
				loc: new Set((local.phones || []).map(phoneKey)),
			},
			emails: {
				on: new Set((online.emails || []).map(emailKey)),
				loc: new Set((local.emails || []).map(emailKey)),
			},
			addresses: {
				on: new Set((online.addresses || []).map(addressKey)),
				loc: new Set((local.addresses || []).map(addressKey)),
			},
			notes: {
				on: new Set((online.notes || []).map(noteKey)),
				loc: new Set((local.notes || []).map(noteKey)),
			},
		};
	}

	function localHadDroppedRows(sets) {
		for (const kind of Object.keys(sets)) {
			const { on, loc } = sets[kind];
			for (const k of loc) {
				if (!on.has(k)) return true;
			}
		}
		return false;
	}

	class FollowingSyncCore {
		static parseUpdatedAtMs(isoOrString) {
			if (isoOrString == null) return null;
			const s = String(isoOrString).trim();
			if (!s) return null;
			const ms = Date.parse(s);
			return Number.isFinite(ms) ? ms : null;
		}

		static normalizeProfile(p) {
			if (!p || typeof p !== "object") return p;
			const out = { ...p };
			if (p.server_updated_at != null) {
				const t = String(p.server_updated_at).trim();
				out.server_updated_at = t || undefined;
			}
			if (typeof p.local_edited_at === "number" && Number.isFinite(p.local_edited_at)) {
				out.local_edited_at = p.local_edited_at;
			}
			return out;
		}

		/**
		 * @param {Array<Record<string, unknown>>} rows - raw API following rows
		 * @returns {{ profiles: Array<Record<string, unknown>> }}
		 */
		static supabaseFollowingToExtensionCaches(rows) {
			const list = Array.isArray(rows) ? rows : [];
			const profiles = list.map((row) => {
				const raw = String(row.updated_at ?? row.updatedAt ?? "").trim();
				const prof = FollowingSyncCore.normalizeProfile({
					...row,
					server_updated_at: raw || undefined,
				});
				return prof;
			});
			return { profiles };
		}

		/**
		 * @param {Array<Record<string, unknown>>} localProfiles
		 * @param {Array<Record<string, unknown>>} onlineProfiles - normalized; each should carry server_updated_at from GET
		 * @param {{ onFollowingStatus?: (msg: string) => void }} [options]
		 */
		static mergeLocalAndOnlineFollowing(localProfiles, onlineProfiles, options) {
			const onStatus = options && typeof options.onFollowingStatus === "function" ? options.onFollowingStatus : null;
			const localList = Array.isArray(localProfiles) ? localProfiles.map((p) => FollowingSyncCore.normalizeProfile(p)) : [];
			const onlineList = Array.isArray(onlineProfiles) ? onlineProfiles.map((p) => FollowingSyncCore.normalizeProfile(p)) : [];

			const onlineById = new Map(onlineList.map((op) => [op.id, op]));
			const merged = [];
			const consumedLocalIds = new Set();

			for (const op of onlineList) {
				const oid = op.id;
				const localMatch = localList.find((l) => l.id === oid) || null;
				if (localMatch) consumedLocalIds.add(localMatch.id);

				const srvMs = FollowingSyncCore.parseUpdatedAtMs(op.server_updated_at);
				const locMs =
					localMatch && typeof localMatch.local_edited_at === "number" ? localMatch.local_edited_at : null;

				let scalars;
				let children;
				let branch = "baseline";

				if (srvMs == null) {
					branch = "baseline";
					scalars = baselineScalars(op, localMatch || {});
					children = unionChildren(op, localMatch || {});
				} else if (locMs == null || srvMs > locMs) {
					branch = "server";
					scalars = serverScalars(op);
					children = serverChildren(op);
					if (localMatch && localHadDroppedRows(childKeySets(op, localMatch))) {
						const label = isNonEmptyScalar(op.name) ? String(op.name).trim() : oid;
						if (onStatus) {
							onStatus(`Some local changes were replaced by newer server data for ${label}.`);
						}
					}
				} else {
					branch = "local";
					scalars = preferLocalScalars(op, localMatch || {});
					children = unionChildren(op, localMatch || {});
				}

				const base = { ...op, ...localMatch, ...scalars, ...children };
				base.id = oid;
				const su = String(op.server_updated_at ?? "").trim();
				if (su) base.server_updated_at = su;
				if (branch === "server") {
					delete base.local_edited_at;
				} else if (localMatch && typeof localMatch.local_edited_at === "number") {
					base.local_edited_at = localMatch.local_edited_at;
				}
				merged.push(FollowingSyncCore.normalizeProfile(base));
			}

			for (const lp of localList) {
				if (consumedLocalIds.has(lp.id)) continue;
				if (onlineById.has(lp.id)) continue;
				merged.push(FollowingSyncCore.normalizeProfile({ ...lp }));
			}

			return merged;
		}
	}

	global.FollowingSyncCore = FollowingSyncCore;
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { FollowingSyncCore };
	}
})(typeof globalThis !== "undefined" ? globalThis : this);
