export type ReingestPayload = {
  sessionId: string;
  docName: string;
};

export const orchestrator = {
  async reingest(payload: ReingestPayload) {
    // Placeholder for LangGraph re-ingestion hook.
    if (process.env.NODE_ENV !== "test") {
      console.info("orchestrator.reingest", payload);
    }
  }
};
