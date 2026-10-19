import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Better Auth's endpoints (/api/auth/sign-in/email, /api/auth/two-factor/..., etc.).
export function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
