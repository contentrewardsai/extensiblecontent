import assert from "node:assert/strict";
import {
	hostnameFromOrigin,
	hostnameMatches,
	normalizeHostname,
	workflowCandidateHostname,
	workflowMatchesHostname,
} from "../lib/workflow-hostname-match";

assert.equal(normalizeHostname(null), null);
assert.equal(normalizeHostname(""), null);
assert.equal(normalizeHostname("  "), null);
assert.equal(normalizeHostname("LABS.GOOGLE"), "labs.google");
assert.equal(normalizeHostname("www.labs.google"), "labs.google");
assert.equal(normalizeHostname("  www.Foo.com "), "foo.com");

assert.equal(hostnameFromOrigin(null), null);
assert.equal(hostnameFromOrigin("not a url"), null);
assert.equal(hostnameFromOrigin("https://labs.google"), "labs.google");
assert.equal(hostnameFromOrigin("https://www.labs.google/path?q=1"), "labs.google");

assert.equal(hostnameMatches(null, "labs.google"), false);
assert.equal(hostnameMatches("labs.google", null), false);
assert.equal(hostnameMatches("labs.google", "labs.google"), true);
assert.equal(hostnameMatches("a.labs.google", "labs.google"), true);
assert.equal(hostnameMatches("notlabs.google", "labs.google"), false);
assert.equal(hostnameMatches("labs.google.evil.com", "labs.google"), false);

assert.equal(workflowCandidateHostname(null), null);
assert.equal(workflowCandidateHostname({}), null);
assert.equal(workflowCandidateHostname({ urlPattern: { origin: "https://labs.google" } }), "labs.google");
assert.equal(workflowCandidateHostname({ urlPattern: { hostname: "WWW.Labs.Google" } }), "labs.google");

assert.equal(
	workflowCandidateHostname({ runs: [{ url: "https://aistudio.labs.google/foo" }] }),
	"aistudio.labs.google",
);
assert.equal(
	workflowCandidateHostname({ analyzed: { actions: [{ url: "https://flow.labs.google/" }] } }),
	"flow.labs.google",
);

assert.equal(workflowMatchesHostname({ urlPattern: { origin: "https://labs.google" } }, "labs.google"), true);
assert.equal(workflowMatchesHostname({ urlPattern: { origin: "https://aistudio.labs.google" } }, "labs.google"), true);
assert.equal(workflowMatchesHostname({ urlPattern: { origin: "https://google.com" } }, "labs.google"), false);
assert.equal(workflowMatchesHostname({}, "labs.google"), false);
assert.equal(workflowMatchesHostname({}, null), true);

console.log("unit-tests: workflow-hostname-match OK");
