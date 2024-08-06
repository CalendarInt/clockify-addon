"use client";

import { fetchUser } from "@/app/proba/queries";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export default function QueryTestComp() {
  const { data: supabaseUser, refetch: refetchSupabaseUser } = useQuery({
    queryKey: ["user"],
    staleTime: Infinity,
    refetchInterval: false,
    enabled: false,
  });

  console.log(supabaseUser);

  return <div>Test</div>;
}
