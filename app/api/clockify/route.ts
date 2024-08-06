import { NextResponse } from "next/server";

export async function POST(request: Request, response: Response) {
  console.log(request.url, "da to je to", request.body);

  return NextResponse.json({ response: "installed" });
}
