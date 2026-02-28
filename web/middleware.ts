import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Minimal middleware — required to force Next.js to generate
// .next/server/middleware-manifest.json at startup.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
