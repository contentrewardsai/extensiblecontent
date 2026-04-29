/**
 * Build the per-location app management URL inside the HighLevel UI.
 *
 * Used in two scenarios for an app that is already installed on a location
 * (i.e. the user is viewing our Custom Page so HL knows about us):
 *
 *   - **First-time token capture failed.** HL fired the OAuth callback to
 *     our `redirect_uri` but our handler errored, so we never stored
 *     access/refresh tokens. The location row exists with placeholder
 *     credentials.
 *   - **Refresh token expired or was revoked.** We had real tokens once
 *     but `getValidLocationToken` now returns 401 from HL. The location
 *     row holds stale credentials.
 *
 * In both cases the user clicks **Reauthorize** on this page and HL
 * re-runs the OAuth handshake against our `redirect_uri`, sending fresh
 * tokens.
 *
 * URL form:
 *   https://app.leadconnectorhq.com/v2/location/<locationId>/integration/<appId>/versions/<versionId>
 *
 * Uses the white-label domain (`leadconnectorhq.com`). The non-white-label
 * `app.gohighlevel.com` redirects through the same flow.
 */
export function buildLocationInstallUrl(locationId: string): string | null {
	const clientId = process.env.GHL_CLIENT_ID;
	if (!clientId) return null;

	// Client IDs look like `<appId>-<versionShortCode>`. The integration and
	// version slugs in the install URL are both the appId (HighLevel reuses
	// the appId as the canonical version id for the initial version).
	const appId = clientId.split("-")[0];
	const versionId = process.env.GHL_APP_VERSION_ID || appId;

	return `https://app.leadconnectorhq.com/v2/location/${encodeURIComponent(locationId)}/integration/${appId}/versions/${versionId}`;
}
