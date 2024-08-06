import { UserRefreshClient } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  let body = await request.json();
  console.log(body.refreshToken, "refreshToken");

  const user = new UserRefreshClient(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    process.env.GOOGLE_SECRET,
    body.refreshToken
  );

  console.log(user, "user");
  

  const { credentials } = await user.refreshAccessToken();
  console.log(credentials, "credentials");

  return NextResponse.json(credentials);
}
