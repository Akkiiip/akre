import type { Lifecycle } from "./domain";
export const transitions: Record<Lifecycle, Lifecycle[]> = {
  DISCOVERED: ["SHORTLISTED", "ARCHIVED"],
  SHORTLISTED: ["APPROVED", "KILLED", "ARCHIVED"],
  APPROVED: ["TESTING", "KILLED", "ARCHIVED"],
  TESTING: ["WINNER", "KILLED"],
  WINNER: ["SCALING", "KILLED"],
  SCALING: ["KILLED", "ARCHIVED"],
  KILLED: ["ARCHIVED"],
  ARCHIVED: [],
};
export function assertTransition(from: Lifecycle, to: Lifecycle) {
  if (!transitions[from].includes(to))
    throw new Error(`Cannot transition ${from} → ${to}`);
}
