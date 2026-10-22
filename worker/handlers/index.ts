import type { JobKind } from "@/db/schema";
import type { JobPayloads } from "@/lib/jobs";
import { designTeam } from "./team";
import { consolidateMemory } from "./memory";
import { onboardingFinalize, onboardingTurn } from "./onboarding";
import { runTask } from "./task";
import { renderEdit } from "../edits";

export const handlers: { [K in JobKind]: (payload: JobPayloads[K]) => Promise<void> } = {
  onboarding_turn: onboardingTurn,
  onboarding_finalize: onboardingFinalize,
  design_team: designTeam,
  run_task: runTask,
  consolidate_memory: consolidateMemory,
  render_edit: renderEdit,
};
