import { NextResponse } from "next/server";

const baseUrl =
  process.env.NODE_ENV === "development"
    ? "https://herring-endless-firmly.ngrok-free.app"
    : "https://clockify-addon-calendar-integrations-projects.vercel.app/";
export async function GET(request: Request) {
  let data = {
    schemaVersion: "1.2",
    key: "GoogleCalendarIntegrationSr",
    name: "Calendar Integration",
    description: "Transfer time entries and approved time offs to Google Calendar",
    baseUrl: baseUrl,
    lifecycle: [
      {
        type: "INSTALLED",
        path: "api/lifecycle/installed",
      },
      {
        type: "DELETED",
        path: "/lifecycle/uninstalled",
      },
      {
        type: "SETTINGS_UPDATED",
        path: "/lifecycle/settings-updated",
      },
    ],
    webhooks: [
      {
        event: "NEW_TIME_ENTRY",
        path: "/api/webhook/new-time-entry",
      },
      {
        event: "TIME_OFF_REQUEST_APPROVED",
        path: "/api/webhook/time-off-request-approved",
      },
      {
        event: "TIMER_STOPPED",
        path: "/api/webhook/timer-stopped",
      },
      {
        event: "TIME_ENTRY_UPDATED",
        path: "/api/webhook/time-entry-updated",
      },
      {
        event: "TIME_OFF_REQUESTED",
        path: "/api/webhook/time-off-requested",
      },
      // {
      //   event: "ASSIGNMENT_PUBLISHED",
      //   path: "/api/webhook/assignment-published",
      // },
      // {
      //   event: "ASSIGNMENT_UPDATED",
      //   path: "/api/webhook/assignment-updated",
      // },
    ],
    components: [
      {
        type: "sidebar",
        accessLevel: "EVERYONE",
        path: "/",
        label: "Google Calendar Sync",
        iconPath: "tab_icon.svg",
      },
    ],
    minimalSubscriptionPlan: "FREE",
    scopes: [
      "CLIENT_READ",
      "PROJECT_READ",
      "TASK_READ",
      "TIME_ENTRY_READ",
      "USER_READ",
      "WORKSPACE_READ",
      "APPROVAL_READ",
      "REPORTS_READ",
      "TIME_OFF_READ",
    ],
  };

  return NextResponse.json(data);
}
