import { createClient } from "@/lib/server";
import axios from "axios";
import { addHours, formatISO, parse } from "date-fns";
import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";

export async function POST(request: Request, response: Response) {
  // console.log(request.url, "da to je to", request.body);
  const body = await request.json();
  const supabase = createClient();
  console.log(body, "time entry updated");
  // return NextResponse.json("res");
  let scopedUser = null;

  const user = await supabase
    .from("users")
    .select()
    .eq("id", body.userId as string);
  if (!user.data) {
    return;
  }
  scopedUser = user.data[0];

  if (!scopedUser?.provider?.google?.connected) {
    console.log("disconnected");
    return NextResponse.json("disconnected");
  } else {
    console.log("connected");
  }

  if (
    user.data &&
    user.data[0].provider?.google?.sync?.googleTimeEntry?.value
  ) {
    if (user.data[0].provider?.google.auth.expiry_date < new Date()) {
      let response = await axios.post(
        (process.env.NODE_ENV === "development"
          ? "https://herring-endless-firmly.ngrok-free.app"
          : "https://clockify-addon-calendar-integrations-projects.vercel.app") +
        "/api/auth/refresh",
        {
          refreshToken: user.data[0].provider.google.auth.refresh_token,
        }
      );
      let newAuthObject = response.data;

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

    let response = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${scopedUser.provider.google.calendarId}/events?q=${body.id}`,
      {
        headers: {
          Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
        },
      }
    );

    try {
      const client = body.project?.clientName
        ? `${body.project?.clientName} : `
        : "";
      const project = body.project?.name ?? "";
      const task = body.task?.name ? ` : ${body.task?.name}` : "";
      const description = body.description ? ` - ${body.description}` : "";

      let response1 = await axios.patch(
        `https://www.googleapis.com/calendar/v3/calendars/${scopedUser.provider.google.calendarId}/events/${response.data.items[0].id}`,
        {
          summary: client + project + task + description,
          start: {
            dateTime: body.timeInterval.start,
          },
          end: {
            dateTime: body.timeInterval.end,
          },
          description: body.description
            ? body.description + "\n" + body.id
            : body.id,
        },
        {
          headers: {
            Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
          },
        }
      );
      console.log(response1.data, "response1.data");
      return NextResponse.json("response.data");
    } catch (error) {
      console.log((error as any).message, "error");
    }
  }

  return NextResponse.json("installed");
}
