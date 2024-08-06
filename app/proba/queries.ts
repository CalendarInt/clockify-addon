import { createClient } from "@/lib/client";
import axiosInstance from "./axiosInterceptorInstance";
import { QueryClient } from "@tanstack/react-query";
import { ClockifyToken } from "@/lib/models/clockify-token";
import {
  subMonths,
  addYears,
  addHours,
  parse,
  formatISO,
  addMonths,
} from "date-fns";

export const fetchCalendars = async (supabaseUser: any) => {
  localStorage.setItem(
    "auth",
    JSON.stringify(supabaseUser.provider.google.auth)
  );

  const response = await axiosInstance.get(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    {
      headers: {
        Authorization: `Bearer ${supabaseUser.provider.google.auth.access_token}`,
      },
    }
  );

  return response.data;
};

export const fetchUser = async (jwt: ClockifyToken) => {
  const supabase = createClient();
  const exisitingUser = await supabase
    .from("users")
    .select()
    .eq("id", jwt.user);

  if (!exisitingUser.data?.length) {
    const createdUser = await supabase
      .from("users")
      .insert({
        id: jwt.user,
      })
      .select("*");
    if (createdUser.data?.length) {
      localStorage.setItem(
        "auth",
        JSON.stringify(createdUser.data[0].provider)
      );
      return createdUser.data[0];
    }
  }
  if (exisitingUser.data?.length) {
    localStorage.setItem(
      "auth",
      JSON.stringify(exisitingUser.data[0].provider)
    );
    return exisitingUser.data[0];
  }
};

export const fetchGoogleCalendars = async (
  jwt: ClockifyToken,
  queryClient: QueryClient
) => {
  let scopedUser = queryClient.getQueryData(["user"]) as any;
  const supabase = createClient();

  if (scopedUser.provider?.google.auth.expiry_date < new Date()) {
    let response = await axiosInstance.post(
      (process.env.NODE_ENV === "development"
        ? "https://herring-endless-firmly.ngrok-free.app"
        : "https://clockify-lakic94s-projects.vercel.app") +
        "/api/auth/refresh",

      {
        refreshToken: scopedUser.provider.google.auth.refresh_token,
      }
    );
    let newAuthObject = response.data;

    let updatedUser = await supabase
      .from("users")
      .update({
        provider: {
          ...scopedUser.provider,
          ...{
            google: {
              auth: newAuthObject,
              sync: scopedUser.provider.google.sync,
              calendarId: scopedUser.provider.google.calendarId,
              connected: true,
            },
          },
        },
      })
      .eq("id", jwt.user as string)
      .select("*");
    if (updatedUser?.data) {
      scopedUser = updatedUser.data[0];
      queryClient.setQueryData(["user"], updatedUser.data[0]);
    }
  }
  let response = await axiosInstance.get(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    {
      headers: {
        Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
      },
    }
  );

  if (!response) {
    return null;
  }

  let clockifyCalendar = null;
  const has = response.data.items.some((item: any) => {
    if (item.summary === "Clockify Addon Calendar") {
      clockifyCalendar = item;
    }

    return item.summary === "Clockify Addon Calendar";
  });

  let googleCalendar = null;

  if (!has) {
    const newCalendar = await axiosInstance.post(
      "https://www.googleapis.com/calendar/v3/calendars",
      {
        summary: "Clockify Addon Calendar",
      },
      {
        headers: {
          Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
        },
      }
    );

    googleCalendar = newCalendar.data.id;
  } else {
    response.data.items.find((item: any) => {
      if (item.summary === "Clockify Addon Calendar") {
        googleCalendar = item.id;
      }
    });
  }

  let updatedUser = await supabase
    .from("users")
    .update({
      provider: {
        ...scopedUser.provider,
        ...{
          google: {
            auth: scopedUser.provider.google.auth,
            sync: scopedUser.provider.google.sync,
            calendarId: googleCalendar,
            connected: true,
          },
        },
      },
    })
    .eq("id", jwt.user as string)
    .select("*");
  if (updatedUser?.data) {
    scopedUser = updatedUser.data[0];
    queryClient.setQueryData(["user"], updatedUser.data[0]);
  }

  return clockifyCalendar;
};

export const timeEntriesSyncMutation = async (
  jwt: ClockifyToken,
  authToken: string,
  queryClient: QueryClient,
  controlValue: boolean,
  calendar: string,
  type: string
) => {
  let scopedUser = queryClient.getQueryData(["user"]) as any;

  if (!controlValue || scopedUser.provider.google.sync[type].initialized) {
    await updateFormStateInDatabase(
      scopedUser,
      type,
      controlValue,
      jwt,
      queryClient
    );
    return [];
  }

  try {
    const detailedReport = await axiosInstance.post(
      `https://developer.clockify.me/report/v1/workspaces/${jwt.workspaceId}/reports/detailed`,
      {
        dateRangeEnd: addMonths(new Date(), 1),
        dateRangeStart: subMonths(new Date(), 1),
        detailedFilter: {},
        amountShown: "HIDE_AMOUNT",
        users: {
          ids: [jwt.user],
        },
      },
      {
        headers: {
          "x-addon-token": authToken,
          // "X-Api-Key": "YTYwYzRlYTMtM2NmNC00NGEwLWJmYWQtZDRjNGVmZjA2MDRk",
        },
      }
    );

    const timeEntries = detailedReport.data.timeentries.filter(
      (timeEntry: any) => {
        const client = timeEntry.clientName
          ? `${timeEntry?.clientName} : `
          : "";
        const project = timeEntry.projectName ?? "";
        const task = timeEntry.taskName ? ` : ${timeEntry.taskName}` : "";
        const description = timeEntry.description
          ? ` - ${timeEntry.description}`
          : "";
        timeEntry.description = `${client}${project}${task}${description}`;
        return timeEntry.type === "REGULAR";
      }
    );
    if (calendar === "Google" && timeEntries.length > 0) {
      await syncWithGoogleCalendar(timeEntries, queryClient);
    } else if (calendar === "Azure" && timeEntries.length > 0) {
      await syncWithAzureCalendar(timeEntries, queryClient);
    }
  } catch (error) {
    throw error;
  }

  await updateFormStateInDatabase(
    scopedUser,
    type,
    controlValue,
    jwt,
    queryClient
  );
};

export const timeOffSyncMutation = async (
  jwt: ClockifyToken,
  queryClient: QueryClient,
  controlValue: boolean,
  calendar: string,
  type: string
) => {
  let scopedUser = queryClient.getQueryData(["user"]) as any;

  updateFormStateInDatabase(scopedUser, type, controlValue, jwt, queryClient);
};

export const detailedReportMutation = async (
  jwt: ClockifyToken,
  authToken: string,
  queryClient: QueryClient
) => {
  const detailedReport = await axiosInstance.post(
    `https://developer.clockify.me/report/v1/workspaces/${jwt.workspaceId}/reports/detailed`,
    {
      dateRangeEnd: addMonths(new Date(), 3),
      dateRangeStart: subMonths(new Date(), 3),
      detailedFilter: {},
      amountShown: "HIDE_AMOUNT",
      users: {
        ids: [jwt.user],
      },
    },
    {
      headers: {
        "x-addon-token": authToken,
        // "X-Api-Key": "YTYwYzRlYTMtM2NmNC00NGEwLWJmYWQtZDRjNGVmZjA2MDRk",
      },
    }
  );

  console.log(detailedReport.data);
};

// export const detailedReportMutation = async (
//   jwt: ClockifyToken,
//   authToken: string,
//   queryClient: QueryClient
// ) => {
//   const detailedReport = await axiosInstance.get(
//     `https://developer.clockify.me/pto/v1/workspaces/${jwt.workspaceId}/policies`,
//     {
//       headers: {
//         "x-addon-token": authToken,
//         // "X-Api-Key": "YTYwYzRlYTMtM2NmNC00NGEwLWJmYWQtZDRjNGVmZjA2MDRk",
//         "Access-Control-Allow-Headers": "*",
//         "Access-Control-Allow-Methods": "*,",
//         "Access-Control-Allow-Origin": "*",
//         "Access-Control-Expose-Headers": "*",
//       },
//     }
//   );

//   console.log(detailedReport.data);
// };

export const scheduledTimeSyncMutation = async (
  jwt: ClockifyToken,
  authToken: string,
  queryClient: QueryClient,
  controlValue: boolean,
  calendar: string,
  type: string
) => {
  let scopedUser = queryClient.getQueryData(["user"]) as any;

  if (!controlValue || scopedUser.provider.google.sync[type].initialized) {
    await updateFormStateInDatabase(
      scopedUser,
      type,
      controlValue,
      jwt,
      queryClient
    );
    return [];
  }

  try {
    // return [];
    const scheduledTimes = await axiosInstance.get(
      `https://developer.clockify.me/api/v1/workspaces/${jwt.workspaceId}/scheduling/assignments/all`,
      {
        headers: {
          "x-addon-token": authToken,
          // "X-Api-Key": "YWQwOWI5YWQtMDdkMy00YjNiLWFlZDQtOTJmZGE0ODg1Mjcw",
        },
        params: {
          start: subMonths(new Date(), 3),
          end: addYears(new Date(), 3),
          "page-size": "5000",
          page: "1",
        },
      }
    );

    const dataForSycn = scheduledTimes.data
      .filter((time: any) => time.userId === scopedUser.id)
      .map((time: any) => {
        console.log(time);
        time.timeInterval = {};
        time.timeInterval.start = formatISO(
          parse(time.startTime, "HH:mm", new Date(time.period.start))
        );

        time.timeInterval.end = formatISO(
          addHours(time.timeInterval.start, time.hoursPerDay)
        );

        time.description = time.note;
        return time;
      });
    console.log(dataForSycn);

    if (calendar === "Google" && dataForSycn.length > 0) {
      await syncWithGoogleCalendar(dataForSycn, queryClient);
    } else if (calendar === "Azure" && dataForSycn.length > 0) {
      await syncWithAzureCalendar(dataForSycn, queryClient);
    }
  } catch (error) {
    throw error;
  }

  updateFormStateInDatabase(scopedUser, type, controlValue, jwt, queryClient);
};

function syncWithAzureCalendar(timeEntries: any, queryClient: QueryClient) {}

async function syncWithGoogleCalendar(
  timeEntries: any,
  queryClient: QueryClient
) {
  console.log(timeEntries);

  let scopedUser = queryClient.getQueryData(["user"]) as any;

  const boundary = "batch_google_calendar";
  let combinedBody = "";
  timeEntries.forEach((entrie: any) => {
    console.log(entrie);

    combinedBody += `--${boundary}`;
    combinedBody += `\r\n`;
    combinedBody += `Content-Type: application/http`;
    combinedBody += `\r\n`;
    combinedBody += `Authorization: ${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`;
    combinedBody += `\r\n`;
    combinedBody += `\r\n`;
    combinedBody += `POST /calendar/v3/calendars/${scopedUser.provider.google.calendarId}/events`;
    combinedBody += `\r\n`;
    combinedBody += `Content-Type: application/json`;
    combinedBody += `\r\n`;
    combinedBody += `\r\n`;

    combinedBody += `{
  "summary": "${entrie.description}",
  "description": "${entrie.id}",
  "colorId": "9",
  "start": {
    "dateTime": "${entrie.timeInterval.start}"
  },
  "end": {
    "dateTime": "${entrie.timeInterval.end}"
  }
}`;
    combinedBody += `\r\n`;
  });

  combinedBody += `--${boundary}--`;

  const contentLength = Buffer.byteLength(combinedBody, "utf-8");

  try {
    const response = await axiosInstance.post(
      `https://www.googleapis.com/batch/calendar/v3`,
      combinedBody,
      {
        headers: {
          Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
          "Content-Length": contentLength,
        },
      }
    );

    return response;
  } catch (error) {
    throw error;
  }
}

async function updateFormStateInDatabase(
  scopedUser: any,
  type: string,
  formControlValue: any,
  jwt: ClockifyToken,
  queryClient: QueryClient
) {
  const supabase = createClient();

  let updatedUser = await supabase
    .from("users")
    .update({
      provider: {
        ...scopedUser.provider,
        ...{
          google: {
            auth: scopedUser.provider.google.auth,
            sync: {
              ...scopedUser.provider.google.sync,
              ...{
                [type]: {
                  value: formControlValue,
                  initialized: true,
                },
              },
            },
            calendarId: scopedUser.provider.google.calendarId,
            connected: true,
          },
        },
      },
    })
    .eq("id", jwt.user)
    .select("*");

  if (updatedUser?.data) {
    queryClient.setQueryData(["user"], updatedUser.data[0]);
  }
}

export async function disconnectUserFromCalendar(
  jwt: ClockifyToken,
  scopedUser: any,
  queryClient: any
) {
  const supabase = createClient();
  let updatedUser = await supabase
    .from("users")
    .update({
      provider: {
        ...scopedUser.provider,
        ...{
          google: {
            auth: scopedUser.provider.google.auth,
            sync: scopedUser.provider.google.sync,
            calendarId: scopedUser.provider.google.calendarId,
            connected: false,
          },
        },
      },
    })
    .eq("id", jwt.user)
    .select("*");

  if (updatedUser?.data) {
    queryClient.setQueryData(["user"], updatedUser.data[0]);
  }
}
