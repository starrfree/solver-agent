/**
 * Load everything an export needs from MongoDB and shape it into the
 * renderer-independent `ExportDocument`, plus the binaries (artifacts, code)
 * that go into the bundle next to the rendered documents.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  Conversation,
  ConversationMessage,
  GeneratedFile,
  Ledger,
  LedgerEntry,
  LedgerEntryTool,
  UsageAgentRole,
} from "../db/types";
import { DEFAULT_REASONING_SPEED } from "../db/types";
import { conversationRepo } from "../repositories/conversationRepo";
import { filesRepo } from "../repositories/filesRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { usageRepo, type UsageBreakdownRow } from "../repositories/usageRepo";
import { isComputationType, isRasterImage, TOOL_TO_ROLE } from "./labels";
import { collectSystemPrompts, combinedPromptHash } from "./systemPromptCatalog";
import type {
  ExportBinary,
  ExportBundle,
  ExportComputation,
  ExportDocument,
  ExportEntry,
  ExportFile,
  ExportHeader,
  ExportMessage,
  ExportModelRow,
  ExportPrompt,
  ExportVerification,
  ExportVerificationIssue,
} from "./types";

const ENABLED_TOOL_LABELS: Record<string, string> = {
  cyAnalyst: "Calabi-Yau Analyst",
  referenceSeeker: "Reference Seeker",
};

const CODE_EXTENSION: Partial<Record<LedgerEntryTool, string>> = {
  symbolic: "py",
  numerical: "py",
  cy_analyst: "py",
};

/** Keys of `content.details` that the typed sections already present. */
const KNOWN_DETAIL_KEYS = new Set([
  "body",
  "task",
  "result",
  "error",
  "status",
  "method",
  "counterExample",
  "focus",
  "targetEntryId",
  "issues",
  "candidateAnswer",
]);

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const SOLVER_AGENT_VERSION = readPackageVersion();

function iso(d: Date | string | undefined): string {
  if (!d) return "";
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v, null, 2);
}

/**
 * Keep file names safe to place in a zip and to reference from LaTeX (no
 * traversal, no separators, no spaces or shell/TeX-special characters).
 */
export function safeFileName(name: string, fallback = "file"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\-]/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

function slugTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "conversation"
  );
}

function modelsByRole(rows: UsageBreakdownRow[]): Map<UsageAgentRole, string[]> {
  const map = new Map<UsageAgentRole, string[]>();
  for (const row of rows) {
    const list = map.get(row.role) ?? [];
    if (!list.includes(row.model)) list.push(row.model);
    map.set(row.role, list);
  }
  return map;
}

function buildHeader(
  conversation: Conversation,
  ledger: Ledger,
  usage: UsageBreakdownRow[],
  promptsSha256: string,
  exportedAt: Date,
): ExportHeader {
  const enabledTools = Object.entries(conversation.additionalTools ?? {})
    .filter(([, on]) => on === true)
    .map(([key]) => ENABLED_TOOL_LABELS[key] ?? key);

  const models: ExportModelRow[] = usage
    .map((r) => ({ role: r.role, model: r.model, calls: r.calls }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.model.localeCompare(b.model));

  return {
    title: conversation.title,
    conversationId: conversation._id,
    ledgerId: ledger._id,
    exportedAt: exportedAt.toISOString(),
    createdAt: iso(conversation.createdAt),
    ledgerStatus: ledger.status,
    reasoningSpeed: conversation.reasoningSpeed ?? DEFAULT_REASONING_SPEED,
    enabledTools,
    models,
    promptsSha256,
    solverAgentVersion: SOLVER_AGENT_VERSION,
  };
}

function buildPrompts(ledger: Ledger, messages: ConversationMessage[]): ExportPrompt[] {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // The first user message is the problem statement; the ledger keeps its own
  // copy, which is authoritative if the message list is empty (e.g. forks).
  if (userMessages.length === 0) {
    return [{ index: 0, createdAt: iso(ledger.createdAt), content: ledger.problemStatement }];
  }
  return userMessages.map((m, index) => ({
    index,
    createdAt: iso(m.createdAt),
    content: m.content,
  }));
}

function buildMessages(messages: ConversationMessage[]): ExportMessage[] {
  return messages
    .filter((m): m is ConversationMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant",
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((m) => ({
      id: m._id,
      role: m.role,
      createdAt: iso(m.createdAt),
      content: m.content,
      relatedEntries: [...(m.relatedEntries ?? [])],
    }));
}

function buildComputation(
  entry: LedgerEntry,
  files: GeneratedFile[],
  binaries: ExportBinary[],
): ExportComputation {
  const details = entry.content.details ?? {};
  const artifacts = entry.artifacts ?? {};
  const exportFiles: ExportFile[] = [];
  const usedNames = new Set<string>();

  const persisted = new Map(files.map((f) => [f._id, f]));
  for (const ref of artifacts.files ?? []) {
    let name = safeFileName(ref.name);
    let n = 1;
    while (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
      n += 1;
    }
    usedNames.add(name);

    const file = ref.fileId ? persisted.get(ref.fileId) : undefined;
    const skipped = ref.skipped === true || !file;
    const path = skipped ? undefined : `artifacts/${entry._id}/${name}`;
    if (file && path) binaries.push({ path, data: file.data });
    exportFiles.push({
      ...(file ? { fileId: file._id } : {}),
      name: ref.name,
      path: path ?? "",
      mimeType: ref.mimeType,
      size: ref.size,
      isImage: !skipped && isRasterImage(ref.mimeType),
      skipped,
      ...(ref.reason ? { reason: ref.reason } : skipped && !file ? { reason: "file not found in storage" } : {}),
    });
  }

  let codePath: string | undefined;
  if (artifacts.code) {
    const ext = CODE_EXTENSION[entry.tool] ?? "txt";
    codePath = `code/${entry._id}.${ext}`;
    binaries.push({ path: codePath, data: Buffer.from(artifacts.code, "utf8") });
  }

  return {
    ...(asString(details.task) !== undefined ? { task: asString(details.task) } : {}),
    ...(asString(details.status) !== undefined ? { status: asString(details.status) } : {}),
    ...(asString(details.result) !== undefined ? { result: asString(details.result) } : {}),
    ...(asString(details.error) !== undefined ? { error: asString(details.error) } : {}),
    ...(artifacts.code ? { code: artifacts.code } : {}),
    ...(codePath ? { codePath } : {}),
    ...(artifacts.stdout ? { stdout: artifacts.stdout } : {}),
    ...(artifacts.stderr ? { stderr: artifacts.stderr } : {}),
    ...(artifacts.durationMs !== undefined ? { durationMs: artifacts.durationMs } : {}),
    files: exportFiles,
  };
}

function buildVerification(entry: LedgerEntry): ExportVerification {
  const details = entry.content.details ?? {};
  const issuesRaw = Array.isArray(details.issues) ? details.issues : undefined;
  const issues: ExportVerificationIssue[] | undefined = issuesRaw
    ?.filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i) => ({
      entryId: asString(i.entryId) ?? "",
      problem: asString(i.problem) ?? "",
      requiredCorrection: asString(i.requiredCorrection) ?? "",
    }));

  return {
    ...(entry.content.verdict ? { verdict: entry.content.verdict } : {}),
    ...(asString(details.method) !== undefined ? { method: asString(details.method) } : {}),
    ...(entry.content.justification ? { justification: entry.content.justification } : {}),
    ...(asString(details.counterExample) !== undefined
      ? { counterExample: asString(details.counterExample) }
      : {}),
    ...(asString(details.focus) !== undefined ? { focus: asString(details.focus) } : {}),
    ...(asString(details.targetEntryId) !== undefined
      ? { targetEntryId: asString(details.targetEntryId) }
      : {}),
    ...(asString(details.candidateAnswer) !== undefined
      ? { candidateAnswer: asString(details.candidateAnswer) }
      : {}),
    ...(issues && issues.length > 0 ? { issues } : {}),
  };
}

function buildEntry(
  entry: LedgerEntry,
  filesByEntry: Map<string, GeneratedFile[]>,
  models: Map<UsageAgentRole, string[]>,
  binaries: ExportBinary[],
): ExportEntry {
  const details = entry.content.details ?? {};
  const role = TOOL_TO_ROLE[entry.tool];
  const body = asString(details.body);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (!KNOWN_DETAIL_KEYS.has(k) && v !== undefined && v !== null && v !== "") extra[k] = v;
  }

  const out: ExportEntry = {
    id: entry._id,
    type: entry.type,
    tool: entry.tool,
    status: entry.status,
    ...(entry.reasoningSpeed ? { reasoningSpeed: entry.reasoningSpeed } : {}),
    createdAt: iso(entry.createdAt),
    dependsOn: [...entry.dependsOn],
    summary: entry.content.summary,
    ...(body ? { body } : {}),
    models: role ? (models.get(role) ?? []) : [],
    ...(Object.keys(extra).length > 0 ? { extraDetails: extra } : {}),
  };

  if (isComputationType(entry.type)) {
    out.computation = buildComputation(entry, filesByEntry.get(entry._id) ?? [], binaries);
  }
  if (entry.type === "verification") {
    out.verification = buildVerification(entry);
  }
  if (entry.type === "final_answer") {
    const fa = entry.content.finalAnswer ?? body ?? entry.content.summary;
    out.finalAnswer = fa;
  }
  return out;
}

/** The stored records an export is built from. */
export interface ExportRecords {
  conversation: Conversation;
  ledger: Ledger;
  entries: LedgerEntry[];
  messages: ConversationMessage[];
  files: GeneratedFile[];
  usage: UsageBreakdownRow[];
}

/** Load a conversation's records from MongoDB and build its export bundle. */
export async function buildExport(conversationId: string, now = new Date()): Promise<ExportBundle> {
  const conversation = await conversationRepo.requireById(conversationId);
  const ledger = await ledgerRepo.requireById(conversation.ledgerId);
  const [entries, messages, files, usage] = await Promise.all([
    ledgerRepo.listEntries(ledger._id),
    conversationRepo.listMessages(conversation._id),
    filesRepo.findByLedger(ledger._id),
    usageRepo.breakdown(conversation._id),
  ]);
  return buildExportFromRecords({ conversation, ledger, entries, messages, files, usage }, now);
}

/** Pure part of the export: records in, document + `ledger.json` + binaries out. */
export function buildExportFromRecords(records: ExportRecords, now = new Date()): ExportBundle {
  const { conversation, ledger, entries, messages, files, usage } = records;

  const systemPrompts = collectSystemPrompts(conversation.additionalTools);
  const promptsSha256 = combinedPromptHash(systemPrompts);
  const header = buildHeader(conversation, ledger, usage, promptsSha256, now);
  const prompts = buildPrompts(ledger, messages);

  const filesByEntry = new Map<string, GeneratedFile[]>();
  for (const f of files) {
    const list = filesByEntry.get(f.entryId) ?? [];
    list.push(f);
    filesByEntry.set(f.entryId, list);
  }
  const models = modelsByRole(usage);
  const binaries: ExportBinary[] = [];
  const exportEntries = entries.map((e) => buildEntry(e, filesByEntry, models, binaries));

  const document: ExportDocument = {
    header,
    prompts,
    entries: exportEntries,
    systemPrompts,
    messages: buildMessages(messages),
  };

  // Raw records for programmatic consumers. `userId` is dropped, file bytes
  // are replaced by their bundle path, and OpenAI response ids are kept out.
  const { userId: _userId, ...conversationPublic } = conversation;
  void _userId;
  const ledgerJson = {
    exportedAt: header.exportedAt,
    solverAgentVersion: header.solverAgentVersion,
    conversation: conversationPublic,
    ledger,
    messages: messages.filter((m) => m.role !== "system"),
    entries: entries.map((e) => {
      const { openaiResponseIds: _ids, ...artifacts } = e.artifacts ?? {};
      void _ids;
      return { ...e, artifacts };
    }),
    files: exportEntries.flatMap((e) =>
      (e.computation?.files ?? []).map((f) => ({ entryId: e.id, ...f })),
    ),
    usage,
    systemPrompts: systemPrompts.map(({ name, label, sha256 }) => ({ name, label, sha256 })),
  };

  const stamp = header.exportedAt.slice(0, 10);
  const fileName = `solver-agent-${slugTitle(conversation.title)}-${stamp}.zip`;

  return { document, ledgerJson, binaries, fileName };
}
