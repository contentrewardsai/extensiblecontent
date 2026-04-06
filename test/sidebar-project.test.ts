import assert from "node:assert/strict";
import { isProjectOwnedByUser } from "../lib/sidebar-project";

const pid = "550e8400-e29b-41d4-a716-446655440000";
const uid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function mockSupabase(result: { data: unknown; error: unknown }) {
	return {
		from() {
			return {
				select() {
					return this;
				},
				eq() {
					return this;
				},
				maybeSingle: async () => result,
			};
		},
	};
}

void (async () => {
	const ok1 = await isProjectOwnedByUser(mockSupabase({ data: { id: pid }, error: null }) as never, uid, pid);
	assert.equal(ok1, true);
	const ok2 = await isProjectOwnedByUser(mockSupabase({ data: null, error: null }) as never, uid, pid);
	assert.equal(ok2, false);
	console.log("unit-tests: sidebar-project OK");
})();
