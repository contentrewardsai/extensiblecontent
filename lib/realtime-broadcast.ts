/**
 * Broadcasts list_updated to sidebar Realtime channels via Supabase REST API.
 * Used after register, update, or disconnect to notify sidebars to refetch.
 */

const LIST_UPDATED_EVENT = "list_updated";
const LIST_UPDATED_PAYLOAD = { type: "list_updated" };

function getRealtimeUrl(): string {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL not configured");
	// e.g. https://xxx.supabase.co -> https://xxx.supabase.co/realtime/v1/api/broadcast
	return `${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`;
}

function getSupabaseKey(): string {
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
	return key;
}

/**
 * Sends list_updated to each sidebar channel for the given sidebar IDs.
 * Uses REST API so no WebSocket subscription is needed on the server.
 */
export async function broadcastListUpdatedToSidebars(sidebarIds: string[]): Promise<void> {
	if (sidebarIds.length === 0) return;

	const broadcastUrl = getRealtimeUrl();
	const apikey = getSupabaseKey();

	const messages = sidebarIds.map((id) => ({
		topic: `sidebar:${id}`,
		event: LIST_UPDATED_EVENT,
		payload: LIST_UPDATED_PAYLOAD,
	}));

	const res = await fetch(broadcastUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			apikey,
		},
		body: JSON.stringify({ messages }),
	});

	if (!res.ok) {
		const text = await res.text();
		console.error("[realtime-broadcast] Failed to broadcast:", res.status, text);
		// Don't throw - broadcast failure shouldn't fail the API request
	}
}
