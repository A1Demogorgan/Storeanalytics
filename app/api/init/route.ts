import { NextResponse } from "next/server";
import { ensureDatasetLoaded, getDebugStatus, getInitStatus } from "@/lib/duckdb";

export const runtime = "nodejs";

export async function GET() {
  const status = getInitStatus();
  const debug = getDebugStatus();
  if (status.state === "idle") {
    void ensureDatasetLoaded();
    return NextResponse.json({ status: "loading", debug });
  }
  return NextResponse.json({ ...status, debug });
}
