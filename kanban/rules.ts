// Card rules, enforced on every write that leaves a card open. A card that
// breaks them is refused with every problem listed, so the writer (usually an
// agent) can fix the card in one go. Closed cards (done, archived) skip them.
import { CLOSED, type Action, type Item } from "./statuses";

export const LIMITS = {
  title: 60,
  why: 120,
  tag: 16,
  tags: 3,
  label: 28,
  promptMin: 200,
  waitsOn: 80,
} as const;

const TAG = /^[a-z0-9][a-z0-9-]*$/;
const BANNED_PREFIX = /^(decide|do|todo|task|ask|question|re-?check)\b\s*[:\-–]/i;
const IDS = /\b(thr_[a-z0-9]+|prop_[a-f0-9]+|proj_[a-z0-9]+)\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6}\b/;

export const DONE_WHEN = /done when/i;

function actionProblems(a: Action, n: number): string[] {
  const where = `action ${n + 1} ("${a.label ?? ""}")`;
  const out: string[] = [];
  const label = (a.label ?? "").trim();
  if (!label) out.push(`${where}: label is required`);
  else if (label.length > LIMITS.label) out.push(`${where}: label is ${label.length} chars, max ${LIMITS.label}`);
  if (a.archive) {
    if (a.prompt) out.push(`${where}: an archive action has no prompt`);
    return out;
  }
  const prompt = (a.prompt ?? "").trim();
  if (prompt.length < LIMITS.promptMin)
    out.push(
      `${where}: prompt is ${prompt.length} chars, min ${LIMITS.promptMin}. It starts a fresh thread with no other context, so include the goal, the files, links and threads to read, and the constraints`,
    );
  if (prompt && !DONE_WHEN.test(prompt)) out.push(`${where}: prompt needs a "Done when:" line that says how the agent knows it finished`);
  if (a.project !== undefined && !/^proj_[a-z0-9]+$/.test(a.project)) out.push(`${where}: project must be a bb project id like proj_personal`);
  return out;
}

/** Every rule the card breaks; empty when it is fine. */
export function cardProblems(item: Pick<Item, "title" | "lane"> & Partial<Item>): string[] {
  if (CLOSED.includes(item.lane)) return [];
  const out: string[] = [];
  const title = item.title.trim();
  if (title.length > LIMITS.title) out.push(`title is ${title.length} chars, max ${LIMITS.title}`);
  if (BANNED_PREFIX.test(title)) out.push(`title starts with a label like "Decide:"; start with the verb or the thing instead`);
  if (/\[[^\]]*\]/.test(title)) out.push(`title has a [tag]; put tags in tags`);
  if (IDS.test(title)) out.push(`title contains an id; put ids and thread refs in the prompt or note`);

  const why = (item.why ?? "").trim();
  if (!why) out.push(`why is required: one sentence on why it matters or what it is`);
  else if (why.length > LIMITS.why) out.push(`why is ${why.length} chars, max ${LIMITS.why}`);
  else if (/\n/.test(why)) out.push(`why must be one line`);

  const tags = item.tags ?? [];
  if (tags.length === 0) out.push(`tags: give 1 to ${LIMITS.tags}, e.g. video, tennis, gmclip, money`);
  if (tags.length > LIMITS.tags) out.push(`tags: ${tags.length} given, max ${LIMITS.tags}`);
  for (const t of tags) if (!TAG.test(t) || t.length > LIMITS.tag) out.push(`tag "${t}": lowercase letters, digits and dashes, max ${LIMITS.tag}`);

  const actions = item.actions ?? [];
  actions.forEach((a, n) => out.push(...actionProblems(a, n)));
  const recommended = actions.filter((a) => a.recommended).length;

  if (item.lane === "needs-you") {
    if (actions.length < 2 || actions.length > 4) out.push(`a needs-you card needs 2 to 4 actions (the choices), has ${actions.length}`);
    if (recommended !== 1) out.push(`a needs-you card marks exactly one action recommended, has ${recommended}`);
  } else if (item.lane === "blocked") {
    const w = (item.waitsOn ?? "").trim();
    if (!w) out.push(`a blocked card needs waitsOn: what it waits on`);
    else if (w.length > LIMITS.waitsOn) out.push(`waitsOn is ${w.length} chars, max ${LIMITS.waitsOn}`);
  } else {
    if (actions.length < 1 || actions.length > 3) out.push(`a ${item.lane} card needs 1 to 3 actions (the next step an agent can start), has ${actions.length}`);
    if (recommended > 1) out.push(`at most one action is recommended`);
  }
  return out;
}

export class CardError extends Error {
  constructor(readonly problems: string[]) {
    super(`card refused:\n- ${problems.join("\n- ")}`);
  }
}

export function assertCard(item: Pick<Item, "title" | "lane"> & Partial<Item>) {
  const problems = cardProblems(item);
  if (problems.length) throw new CardError(problems);
}

/** The ticket a person's quick add gets, so an agent can turn it into a real card. */
export function draftAction(title: string): Action {
  return {
    label: "Write the ticket",
    recommended: true,
    prompt: `A card titled "${title}" was added to the kanban board by hand with no detail. Work out what it means from recent threads (bb thread search), the kanban board, and the user's notes, then rewrite the card with bb kanban set --spec so it follows the rules in the kanban skill: a short title, a one-line why, 1-3 tags, and actions whose prompts carry all the context a fresh thread needs. If you can't tell what it means, make it a needs-you card asking the user, with your best guesses as the choices. Done when: bb kanban show prints the rewritten card and bb kanban lint reports nothing for it.`,
  };
}
