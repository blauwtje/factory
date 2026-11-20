import { useEffect, useState } from "react";
import { listRoles, type Role } from "@/ipc";
import { EFFORT_ITEMS, MODEL_ITEMS, markDefault } from "./types";

export function useLeadItems() {
  const [lead, setLead] = useState<Role>();
  useEffect(() => {
    listRoles().then((roles) => roles.find(({ name }) => name === "orchestrator")).then(setLead, () => {});
  }, []);
  return { models: markDefault(MODEL_ITEMS, lead?.model), efforts: markDefault(EFFORT_ITEMS, lead?.effort) };
}
