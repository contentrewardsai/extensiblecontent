/**
 * Sidepanel following helpers. Load extension/following-sync-core.js first.
 * followingProfilesCache is the in-memory list mirrored to chrome.storage / project JSON.
 */
(function followingSidepanelFactory(global) {
	"use strict";

	const Core = global.FollowingSyncCore;
	if (!Core) {
		throw new Error("following-sync-core.js must load before sidepanel.js");
	}

	let followingProfilesCache = [];

	function normalizeProfile(p) {
		return Core.normalizeProfile(p);
	}

	function getFollowingProfilesCache() {
		return followingProfilesCache;
	}

	function setFollowingProfilesCache(profiles) {
		followingProfilesCache = Array.isArray(profiles) ? profiles.map((x) => normalizeProfile(x)) : [];
	}

	function touchFollowingProfileEdited(profileId) {
		const p = followingProfilesCache.find((x) => x.id === profileId);
		if (p) p.local_edited_at = Date.now();
	}

	function setFollowingStatus(_msg) {
		/* Override in UI layer; default no-op */
	}

	/**
	 * After successful POST/PATCH following API: refresh server clock and drop local edit marker.
	 * @param {Record<string, unknown>} profile - same reference as in cache when possible
	 * @param {Record<string, unknown>} apiFollowing - parsed JSON body from API
	 */
	function syncFollowingProfileToSupabase(profile, apiFollowing) {
		if (!profile || !apiFollowing || typeof apiFollowing !== "object") return;
		const raw = String(apiFollowing.updated_at ?? apiFollowing.updatedAt ?? "").trim();
		if (raw) profile.server_updated_at = raw;
		delete profile.local_edited_at;
		const idx = followingProfilesCache.indexOf(profile);
		if (idx >= 0) {
			followingProfilesCache[idx] = normalizeProfile(followingProfilesCache[idx]);
		}
	}

	/**
	 * Wrap saves: call after mutating a profile in memory so LWW sees local edits.
	 * Use from every path that edits name, birthday, accounts, phones, emails, addresses, notes.
	 */
	function saveFollowingToLocal(profileId, saveFn) {
		touchFollowingProfileEdited(profileId);
		if (typeof saveFn === "function") saveFn();
	}

	global.followingSidepanel = {
		normalizeProfile,
		getFollowingProfilesCache,
		setFollowingProfilesCache,
		touchFollowingProfileEdited,
		setFollowingStatus,
		syncFollowingProfileToSupabase,
		saveFollowingToLocal,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = global.followingSidepanel;
	}
})(typeof globalThis !== "undefined" ? globalThis : this);
