"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  className?: string;
};

export default function StartSessionButton({ className }: Props) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/session/init", {
        method: "POST",
        credentials: "include"
      });
      if (!res.ok) {
        throw new Error(`Failed to start: ${res.status}`);
      }
      router.push("/app");
    } catch (err) {
      setError("Unable to start a new session. Try again.");
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        data-testid="start-session-btn"
        onClick={handleClick}
        disabled={starting}
        className={`inline-flex w-full items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-base font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-80 sm:w-auto ${
          className ?? ""
        }`}
      >
        {starting ? "Starting…" : "Start new session"}
      </button>
      {error ? (
        <p role="status" className="text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
