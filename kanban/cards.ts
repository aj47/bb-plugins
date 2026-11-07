// The card operations the pages and the CLI share: a person's quick add, a
// full edit, and running a card's action (start a thread, or archive).
import type { BoardStore, CardInput } from "./board";
import { draftAction } from "./rules";
import type { Item } from "./statuses";

export type Spawn = (args: { project?: string; title: string; prompt: string }) => Promise<string>;

const today = () => new Date().toISOString().slice(0, 10);
const addLine = (note: string, line: string) => (note.trim() ? `${note.trimEnd()}\n${line}` : line);

/** Appended to every prompt, so the agent closes the loop on its card. */
export const footer = (item: Item) => `

---
This task comes from kanban card ${item.id} ("${item.title}"). See it with \`bb kanban show ${item.id}\`.
- When it's finished: \`bb kanban done ${item.id} --result "<one line: what changed and where>"\`.
- If you need the user to choose something, do all the work up to that point, then turn the card into a needs-you card with \`bb kanban set ${item.id} --spec-stdin\` (choices as actions, one recommended), following the kanban skill.
- If it's blocked on something else: \`bb kanban set ${item.id} -s blocked --waits-on "<what>"\`.`;

const shortLabel = (text: string) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 28 ? one : `${one.slice(0, 27).trimEnd()}…`;
};

/** The user's instruction first, then everything the card knows. */
export function customPrompt(item: Item, ask: string) {
  const lines = [
    ask,
    "",
    "That is the user's instruction for this kanban card. It overrides the suggested actions below, which are context only.",
    "",
    `Card: ${item.title}`,
    item.why ? `Why: ${item.why}` : "",
    item.tags?.length ? `Tags: ${item.tags.join(", ")}` : "",
    item.waitsOn ? `Waits on: ${item.waitsOn}` : "",
    item.note.trim() ? `Note:\n${item.note.trim()}` : "",
    ...(item.actions ?? [])
      .filter((a) => a.prompt)
      .map((a, n) => `Suggested action ${n + 1} (${a.label}):\n${a.prompt}`),
    "",
    "Done when: the user's instruction is carried out and the card is updated as described below.",
  ];
  return lines.filter((l, n, all) => l !== "" || all[n - 1] !== "").join("\n");
}

export function createCards(board: BoardStore, spawn: Spawn) {
  return {
    list: () => board.list(),
    /** A person's quick add: the card gets a "Write the ticket" action an agent can run. */
    quickAdd(title: string, status: Item["lane"] = "backlog") {
      const t = title.trim();
      const lane = status === "needs-you" || status === "blocked" ? "backlog" : status;
      return board.add({ title: t, status: lane, why: "Added by hand; an agent can turn it into a full ticket.", tags: ["inbox"], actions: [draftAction(t)] });
    },
    edit: (id: string, patch: CardInput) => board.update(id, patch),
    /**
     * Start a thread from the user's own instruction, with the card's context
     * attached. On a needs-you card the instruction becomes the chosen action.
     */
    async runCustom(id: string, text: string): Promise<{ item: Item; threadId: string }> {
      const ask = text.trim();
      if (!ask) throw new Error("say what to do");
      const item = await board.get(id);
      const prompt = customPrompt(item, ask);
      const threadId = await spawn({ project: item.actions?.find((a) => a.recommended)?.project ?? item.actions?.[0]?.project, title: item.title, prompt: `${prompt}${footer(item)}` });
      const patch: CardInput & { addThread: string } = { status: "doing", addThread: threadId };
      if (item.lane === "needs-you" || !item.actions?.length || item.lane === "blocked") {
        patch.note = addLine(item.note, `${today()}: chose "${ask}"`);
        patch.actions = [{ label: shortLabel(ask), prompt }];
      }
      return { item: await board.update(item.id, patch), threadId };
    },
    /** Run action `n`: start its thread and move the card to doing, or archive the card. */
    async run(id: string, n: number): Promise<{ item: Item; threadId?: string }> {
      const item = await board.get(id);
      const action = item.actions?.[n];
      if (!action) throw new Error(`card ${item.id} has no action ${n + 1}`);
      const chose = item.lane === "needs-you" ? addLine(item.note, `${today()}: chose "${action.label}"`) : undefined;
      if (action.archive) return { item: await board.update(item.id, { status: "archived", note: chose ?? item.note }) };
      const threadId = await spawn({ project: action.project, title: item.title, prompt: `${action.prompt}${footer(item)}` });
      const patch: CardInput & { addThread: string } = { status: "doing", addThread: threadId };
      if (chose !== undefined) {
        patch.note = chose;
        patch.actions = [{ ...action, recommended: undefined }];
      }
      return { item: await board.update(item.id, patch), threadId };
    },
  };
}

export type Cards = ReturnType<typeof createCards>;
