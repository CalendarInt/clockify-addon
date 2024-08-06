import { createClient } from "@/lib/server";
import axios from "axios";
import { addHours, formatISO, parse } from "date-fns";
import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";

export async function POST(request: Request, response: Response) {
  // console.log(request.url, "da to je to", request.body);
  const body = await request.json();
  const supabase = createClient();
  console.log(body, "assignment published");
  // return NextResponse.json("res");
  let scopedUser = null;

  console.log(1);

  const user = await supabase
    .from("users")
    .select()
    .eq("id", body.userId as string);
  if (!user.data) {
    return;
  }
  scopedUser = user.data[0];
  console.log(2);

  if (!scopedUser?.provider?.google?.connected) {
    console.log("disconnected");
    return NextResponse.json("disconnected");
  } else {
    console.log("connected");
  }

  if (
    user.data &&
    user.data[0].provider?.google?.sync?.googleScheduledTime?.value
  ) {
    console.log(3);
    if (user.data[0].provider?.google.auth.expiry_date < new Date()) {
      let response = await axios.post(
        (process.env.NODE_ENV === "development"
          ? "https://herring-endless-firmly.ngrok-free.app"
          : "https://clockify-lakic94s-projects.vercel.app") +
          "/api/auth/refresh",
        {
          refreshToken: user.data[0].provider.google.auth.refresh_token,
        }
      );
      let newAuthObject = response.data;
      console.log(4);

      let updatedUser = await supabase
        .from("users")
        .update({
          provider: {
            ...user.data[0].provider,
            ...{
              google: {
                auth: newAuthObject,
                sync: user.data[0].provider.google.sync,
                calendarId: user.data[0].provider.google.calendarId,
                connected: true,
              },
            },
          },
        })
        .eq("id", body.userId as string)
        .select("*");
      if (updatedUser?.data) {
        scopedUser = updatedUser.data[0];
      }
    }
    console.log(
      parse(
        body.startTime ?? body.period.start,
        "HH:mm",
        new Date(body.period.start)
      )
    );
    console.log(5);

    const start = formatISO(
      parse(body.startTime ?? "00:00", "HH:mm", new Date(body.period.start))
    );

    console.log(start);

    const end = formatISO(addHours(start, body.hoursPerDay));

    console.log(end);

    let response = await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${scopedUser.provider.google.calendarId}/events`,
      {
        summary: body.note ?? "No title",
        description: body.id,
        start: {
          dateTime: start,
        },
        end: {
          dateTime: end,
        },
      },
      {
        headers: {
          Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
        },
      }
    );

    console.log(response.data);
    return NextResponse.json(response.data);
  }

  return NextResponse.json("installed");
}
