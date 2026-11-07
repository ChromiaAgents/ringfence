import type { Call, Desk } from '../store.ts';

/** A desk is a config file, a system prompt, tools, and the code that enforces the rules behind those tools. */
export type DeskDef = {
  id: Desk;
  greeting: () => string;
  system: (call: Call) => string;
  tools: unknown[];
  run: (call: Call, name: string, args: any) => Promise<unknown>;
  /** Last check on what the agent says, before it is spoken. */
  filter?: (text: string) => { text: string; hit?: string };
  /** A link to hand the caller (launch page, deposit page), if one exists yet. */
  link?: (call: Call) => { url: string; label: string } | null;
};
