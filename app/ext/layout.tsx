import { Suspense } from "react";

export default function GhlLayout({ children }: { children: React.ReactNode }) {
	return <Suspense fallback={<div style={{ padding: 24, fontFamily: "system-ui" }}>Loading...</div>}>{children}</Suspense>;
}
