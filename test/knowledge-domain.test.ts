import assert from "node:assert/strict";
import { normalizeSiteDomain, siteDomainFromBody, siteDomainFromSearchParams } from "../lib/knowledge-domain";

assert.equal(normalizeSiteDomain("https://WWW.Example.COM/path?q=1"), "example.com");
assert.equal(normalizeSiteDomain("example.com"), "example.com");
assert.equal(normalizeSiteDomain("  foo.bar  "), "foo.bar");
assert.equal(normalizeSiteDomain(""), null);
assert.equal(normalizeSiteDomain("not a url"), null);

{
	const ok = siteDomainFromBody({ origin: "https://x.com/y" });
	assert.ok(ok.ok);
	if (ok.ok) assert.equal(ok.site_domain, "x.com");
}
{
	const bad = siteDomainFromBody({});
	assert.ok(!bad.ok);
}
{
	const bad2 = siteDomainFromBody({ origin: "https://a.com", domain: "b.com" });
	assert.ok(!bad2.ok);
}

{
	const sp = new URLSearchParams({ hostname: "WWW.Docs.Example.ORG" });
	const ok = siteDomainFromSearchParams(sp);
	assert.ok(ok.ok);
	if (ok.ok) assert.equal(ok.site_domain, "docs.example.org");
}

console.log("unit-tests: knowledge-domain OK");
