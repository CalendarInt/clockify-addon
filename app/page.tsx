import React, { Suspense } from "react";
import ProbaTest from "./proba/page";
import { GoogleOAuthProvider } from "@react-oauth/google";

export default function Home() {
  return (
    <GoogleOAuthProvider
      clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""}
    >
      <div className="clockify-card cl-border-bottom cl-mb-4 h-20">
        <ProbaTest />
      </div>
    </GoogleOAuthProvider>
  );
}
