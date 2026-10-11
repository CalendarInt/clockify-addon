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

const baseUrl = process.env.NODE_ENV === "development" ? "developer" : "api";

const getBaseUrl = (workspaceId: string) => {
  return process.env.NODE_ENV === "development"
    ? `https://developer.clockify.me/report/v1/workspaces/${workspaceId}/reports/detailed`
    : `https://reports.api.clockify.me/v1/workspaces/${workspaceId}/reports/detailed`;
};

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
        : "https://clockify-addon-calendar-integrations-projects.vercel.app") +
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
              connected: scopedUser.provider.google.connected,
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
      params: {
        maxResults: 250,
      },
    }
  );

  if (!response) {
    return;
  }

  // Reuse the existing addon calendar instead of creating a new one every time:
  // Google rate-limits calendar creation, so repeated toggling used to fail.
  // Prefer the calendar we already stored, then any owned one with the addon name.
  const addonCalendars = response.data.items.filter(
    (item: any) =>
      item.summary === "Clockify Addon Calendar" && item.accessRole === "owner"
  );
  const clockifyCalendar =
    addonCalendars.find(
      (item: any) => item.id === scopedUser.provider.google.calendarId
    ) ??
    addonCalendars[0] ??
    null;

  let googleCalendar = clockifyCalendar?.id;

  if (!googleCalendar) {
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
  }

  // Time offs already live in the reused calendar, so nothing has to be copied over.
  const timeOffEntries = null;

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
            connected: scopedUser.provider.google.connected,
          },
        },
      },
    })
    .eq("id", jwt.user as string)
    .select("*");
  if (updatedUser?.data) {
    scopedUser = updatedUser.data[0];
    queryClient.invalidateQueries({ queryKey: ["user"] });
    queryClient.setQueryData(["user"], updatedUser.data[0]);
  }

  return { clockifyCalendar, timeOffEntries };
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

  if (!controlValue) {
    await updateFormStateInDatabase(
      scopedUser,
      type,
      controlValue,
      jwt,
      queryClient
    );
    return undefined;
  }
  let clockifyCalendar = null;
  let timeOffEntries = null;
  const calendarRes = await fetchGoogleCalendars(jwt, queryClient);

  if (calendarRes) {
    clockifyCalendar = calendarRes.clockifyCalendar;
    timeOffEntries = calendarRes.timeOffEntries;
  }

  scopedUser = queryClient.getQueryData(["user"]) as any;

  const dateRangeStart = subMonths(new Date(), 1);
  const dateRangeEnd = addMonths(new Date(), 1);
  let syncResult: SyncResult | undefined;

  try {
    const detailedReport = await axiosInstance.post(
      getBaseUrl(jwt.workspaceId),
      {
        dateRangeEnd,
        dateRangeStart,
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
        const client = timeEntry?.clientName
          ? `${timeEntry?.clientName} : `
          : "";
        const project = timeEntry?.projectName ?? "";
        const task = timeEntry?.taskName ? ` : ${timeEntry.taskName}` : "";
        const description = timeEntry?.description
          ? ` - ${timeEntry.description}`
          : "";
        timeEntry.description = `${client}${project}${task}${description}`;
        return timeEntry.type === "REGULAR";
      }
    );
    if (calendar === "Google" && timeEntries.length > 0) {
      // The calendar is reused now, so skip entries that are already in it.
      const syncedIds = await fetchSyncedTimeEntryIds(
        scopedUser,
        dateRangeStart,
        dateRangeEnd
      );
      const newTimeEntries = timeEntries.filter(
        (timeEntry: any) => !syncedIds.has(timeEntry._id)
      );
      if (newTimeEntries.length > 0) {
        syncResult = await syncWithGoogleCalendar(
          newTimeEntries,
          queryClient,
          timeOffEntries
        );
      }
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

  return syncResult;
};

export type SyncResult = {
  total: number;
  failed: number;
  firstError?: string;
};

// Collects the Clockify time entry ids found in event descriptions of the
// addon calendar (batch-synced events store the id, webhook events append it).
async function fetchSyncedTimeEntryIds(
  scopedUser: any,
  timeMin: Date,
  timeMax: Date
) {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  do {
    const response = await axiosInstance.get(
      `https://www.googleapis.com/calendar/v3/calendars/${scopedUser.provider.google.calendarId}/events`,
      {
        headers: {
          Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
        },
        params: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          maxResults: 2500,
          pageToken,
        },
      }
    );
    response.data.items?.forEach((event: any) => {
      event.description
        ?.match(/[0-9a-f]{24}/g)
        ?.forEach((id: string) => ids.add(id));
    });
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return ids;
}

// Google answers a batch with 200 even when single events fail,
// so read the status of every part to report the failures.
function parseBatchResponse(body: string, total: number): SyncResult {
  const statuses = Array.from(
    String(body).matchAll(/HTTP\/1\.1 (\d{3})/g),
    (match) => Number(match[1])
  );
  const failed = statuses.filter((status) => status >= 400).length;
  const firstError = String(body).match(/"message":\s*"([^"]*)"/)?.[1];

  return { total, failed, firstError: failed ? firstError : undefined };
}

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
    getBaseUrl(jwt.workspaceId),
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
      `https://${baseUrl}.clockify.me/api/v1/workspaces/${jwt.workspaceId}/scheduling/assignments/all`,
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
  queryClient: QueryClient,
  timeOffEntries?: any
) {
  let scopedUser = queryClient.getQueryData(["user"]) as any;

  const boundary = "batch_google_calendar";
  let combinedBody = "";
  timeEntries.forEach((entrie: any) => {
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

    combinedBody += JSON.stringify({
      summary: entrie.description,
      description: entrie._id,
      colorId: "7",
      start: {
        dateTime: entrie.timeInterval.start,
      },
      end: {
        dateTime: entrie.timeInterval.end,
      },
    });
    combinedBody += `\r\n`;
  });

  if (timeOffEntries) {
    timeOffEntries.forEach((entrie: any) => {
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

      combinedBody += JSON.stringify({
        summary: entrie.summary ?? "",
        description: "timeoff",
        colorId: "2",
        start: {
          dateTime: entrie.start.dateTime,
        },
        end: {
          dateTime: entrie.end.dateTime,
        },
      });
      combinedBody += `\r\n`;
    });
  }

  combinedBody += `--${boundary}--`;

  const total = timeEntries.length + (timeOffEntries?.length ?? 0);

  try {
    // The browser sets Content-Length itself (it refuses a manual value).
    const response = await axiosInstance.post(
      `https://www.googleapis.com/batch/calendar/v3`,
      combinedBody,
      {
        headers: {
          Authorization: `${scopedUser.provider.google.auth.token_type} ${scopedUser.provider.google.auth.access_token}`,
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
        },
      }
    );

    return parseBatchResponse(response.data, total);
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
            connected: scopedUser.provider.google.connected,
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
