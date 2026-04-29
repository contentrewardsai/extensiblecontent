/**
 * Build the per-location install URL inside the HighLevel UI.
 *
 * HighLevel hosts two install entry points:
 *   1. `marketplace.leadconnectorhq.com/oauth/chooselocation?...` — the
 *      universal location picker. Requires a correct `appVersionId` query
 *      param, which doesn't always survive Marketplace UI changes.
 *   2. `app.leadconnectorhq.com/v2/location/<locationId>/integration/...`
 *      — opens the integration page for one specific location. From there
 *      the user clicks Install and HL bounces back to our redirect_uri
 *      with an OAuth code, exactly the same as chooselocation does. No
 *      `appVersionId` query param needed; the version is in the path.
 *
 * We use #2 wherever we already know the location id (i.e. inside the GHL
 * Custom Page iframe). It's also more user-friendly because the user lands
 * directly on the install screen for the location they're already in.
 *
 * The URL uses the white-label domain (`leadconnectorhq.com`). HighLevel
 * agencies on `gohighlevel.com` redirect through the same flow; the
 * white-label form works in both.
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
