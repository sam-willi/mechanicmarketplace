"use client";

import { ErrorState } from "@/components/app/error-state";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState error={error} retry={retry} home="/" />;
}
