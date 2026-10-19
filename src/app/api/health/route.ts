import { NextResponse } from "next/server";

// Liveness probe for docker-compose, CI and later the cloud load balancer.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
