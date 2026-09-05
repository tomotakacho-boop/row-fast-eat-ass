"use client";

import { useEffect, useState } from "react";
import MockDraftHistoryDetail from "../MockDraftHistoryDetail";

export default function MockDraftHistoryPage() {
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => {
      const search = new URLSearchParams(window.location.search);
      setHistoryId(search.get("id") || "");
    });
  }, []);

  if (historyId === null) return <main className="mock-history-page"><section className="mock-history-state"><strong>Loading mock draft…</strong></section></main>;
  return <MockDraftHistoryDetail historyId={historyId}/>;
}
