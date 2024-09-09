import { UserRefreshClient } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  let body = await request.json();
  const user = new UserRefreshClient(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    process.env.GOOGLE_SECRET,
    body.refreshToken
  );

  const { credentials } = await user.refreshAccessToken();

  return NextResponse.json(credentials);
}
