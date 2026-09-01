/**
 * Shared MCP catalog — the ONE definition of LoopGantt's MCP surface.
 *
 * Two servers expose it over two transports:
 *   - packages/loopgantt-mcp (stdio, `npm i -g @loopgantt/mcp-server`) with an
 *     HTTP backend that calls https://loopgantt.com/api/v1;
 *   - app/api/mcp (remote Streamable HTTP, https://loopgantt.com/api/mcp) with
 *     an in-process backend that invokes the same v1 route handlers.
 *
 * Rules for this file: no environment access, no I/O, no imports besides the
 * MCP SDK. It is compiled both by the package (its own tsconfig) and by the app
 * (root tsconfig with `exactOptionalPropertyTypes`,
 * `noPropertyAccessFromIndexSignature`, …), so keep it to plain TypeScript.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/** Version reported by both servers (`serverInfo.version`, client header). */
export const MCP_VERSION = '1.5.0';
export const TEMPLATE_URI_PREFIX = 'loopgantt://templates/';
export const SERVER_INFO = { name: 'loopgantt', version: MCP_VERSION } as const;
export const SERVER_CAPABILITIES = { tools: {}, resources: {}, prompts: {} } as const;

/** Injected into the client's system prompt by MCP hosts that support it. */
export const SERVER_INSTRUCTIONS =
  'LoopGantt turns a task list into a scheduled Gantt chart (critical-path engine, working-day calendar). No account or API key is needed. ' +
  'create_gantt stores a chart and returns a picture, the dates, the critical path and a link; the link is the ONLY handle to the chart and expires (7 days, 30 once opened, forever once saved to a free account), so always show it to the user. ' +
  'Use schedule_project for what-if questions (nothing is stored) and list_templates / get_template for industry starting points. ' +
  'Durations are working days; duration 0 = milestone; dependencies are the 0-based positions of EARLIER tasks (or { task, type: FS|SS|FF|SF, lag }); group tasks under top-level phases with isPhase: true + parent (the phase position); chain only true prerequisites - independent tasks run in parallel. Ask the user for the start date and any deadline before creating (start defaults to today); pass deadline so the chart shows it. When it would change the plan, also ask (max 2-3 questions, one message): solo or team (drives parallelism), working days (workDays; do not assume Mon-Fri), vacations (holidays). ' +
  'A task with a due date (essay due Oct 15, exam on Nov 3, launch day) takes deadline: YYYY-MM-DD - a marker that never moves the schedule; the reply reports each task fit (buffer or days late). ' +
  'Use create_gantt when the user wants a chart they can open, export or save; use schedule_project only for what-if date math where nothing should be stored.';

// ---------------------------------------------------------------------------
// API types (the v1 REST contract, see public/openapi.json)
// ---------------------------------------------------------------------------

export interface DependencyInput {
  task: number;
  type?: 'FS' | 'SS' | 'FF' | 'SF';
  lag?: number;
}

export interface GanttTaskInput {
  name: string;
  duration?: number;
  isMilestone?: boolean;
  isPhase?: boolean;
  parent?: number;
  description?: string;
  dependencies?: Array<number | DependencyInput>;
  /** Finish-by date YYYY-MM-DD — a marker, never a constraint. */
  deadline?: string;
}

export interface PlanRequest {
  name?: string;
  description?: string;
  startDate?: string;
  /** Project deadline YYYY-MM-DD (drawn on the chart; the reply reports the fit). */
  deadline?: string;
  workDays?: number[];
  holidays?: string[];
  tasks: GanttTaskInput[];
}

/** How a scheduled end relates to a deadline marker. */
export interface DeadlineFit {
  late: boolean;
  /** Calendar days from the scheduled end to the deadline: >0 buffer, <0 late. */
  days: number;
}

export interface ScheduledTask {
  id?: string;
  index?: number;
  name: string;
  start: string;
  /** Last working day of the task (inclusive); milestones have start = end. */
  end: string;
  durationDays: number;
  isMilestone: boolean;
  isPhase?: boolean;
  isCritical: boolean;
  totalFloat: number;
  deadline?: string | null;
  fit?: DeadlineFit | null;
}

export interface ScheduleSummary {
  projectStartDate: string;
  projectEndDate: string;
  projectDurationDays: number;
  criticalPath: Array<string | number>;
  tasks: ScheduledTask[];
}

export interface CreateGanttResponse {
  data: {
    name: string;
    description: string | null;
    startDate: string;
    deadline?: string | null;
    /** Project-level fit against `deadline`; null without one. */
    fit?: (DeadlineFit & { deadline: string; projectEndDate: string }) | null;
    taskCount: number;
    dependencyCount: number;
    claimUrl: string;
    previewUrl: string;
    imageUrl?: string;
    expiresAt: string;
    expiresInDays: number;
    schedule: ScheduleSummary;
  };
  meta: { message: string; rateLimit?: { limit: number; remaining: number } };
}

export interface ScheduleResponse {
  data: ScheduleSummary;
}

export interface TemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  taskCount: number;
  estimatedDays: number;
  url: string;
}

export interface TemplateDetail extends TemplateSummary {
  useCase: string;
  whyLoopGantt: string;
  tasks: Array<{
    index: number;
    name: string;
    duration: number;
    description: string;
    isMilestone: boolean;
  }>;
}

export interface ListTemplatesResponse {
  data: TemplateSummary[];
  meta: { count: number };
}

export interface TemplateResponse {
  data: TemplateDetail;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  startDate?: string;
  tasks: Array<{
    name: string;
    duration?: number;
    dependencies?: number[];
    description?: string;
    isMilestone?: boolean;
  }>;
}

export interface CreateProjectResponse {
  data: {
    id: string;
    name: string;
    description: string | null;
    startDate: string;
    taskCount: number;
    dependencyCount: number;
    url: string;
  };
  meta: { message: string };
}

export interface ListProjectsResponse {
  data: Array<{ id: string; name: string; status: string; url: string }>;
  meta: { count: number };
}

/** A failed API call: `status` 0 = never reached the API (network, no key). */
export interface ApiFailure {
  error: { code: string; message: string; status: number; retryAfter?: number };
}

export type ApiResult<T> = T | ApiFailure;

export function isFailure<T>(r: ApiResult<T>): r is ApiFailure {
  return typeof r === 'object' && r !== null && 'error' in r;
}

/** What a backend has after reading an HTTP-style response (pure input for `responseToResult`). */
export interface ApiResponseShape {
  readonly ok: boolean;
  readonly status: number;
  /** Parsed JSON body, or null when the body was not JSON. */
  readonly json: unknown;
  readonly retryAfter: string | null;
}

/** Shared mapping of an API response to a result — used by both backends. */
export function responseToResult<T>(r: ApiResponseShape): ApiResult<T> {
  if (r.ok) {
    if (typeof r.json === 'object' && r.json !== null) return r.json as T;
    return {
      error: {
        code: 'BAD_RESPONSE',
        message: `LoopGantt returned an unreadable response (HTTP ${String(r.status)})`,
        status: r.status,
      },
    };
  }
  const apiError = (r.json as { error?: { code?: string; message?: string } } | null)?.error;
  const retryAfter = Number(r.retryAfter ?? '');
  return {
    error: {
      code: apiError?.code ?? `HTTP_${String(r.status)}`,
      message: apiError?.message ?? `LoopGantt responded with HTTP ${String(r.status)}`,
      status: r.status,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
    },
  };
}

export function isPngResponse(ok: boolean, contentType: string | null): boolean {
  return ok && (contentType ?? '').startsWith('image/png');
}

/**
 * What a transport-specific server must provide. Keyless methods are
 * mandatory; the account tools are optional (the stdio server supplies them,
 * the remote endpoint has no credential to attach and leaves them out).
 */
export interface McpBackend {
  createGantt(body: PlanRequest): Promise<ApiResult<CreateGanttResponse>>;
  schedule(body: PlanRequest): Promise<ApiResult<ScheduleResponse>>;
  listTemplates(): Promise<ApiResult<ListTemplatesResponse>>;
  getTemplate(slug: string): Promise<ApiResult<TemplateResponse>>;
  /** PNG of a created chart, base64 — `null` when unavailable (never throws). */
  fetchImageBase64(token: string): Promise<string | null>;
  createProject?(body: CreateProjectRequest): Promise<ApiResult<CreateProjectResponse>>;
  listProjects?(): Promise<ApiResult<ListProjectsResponse>>;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Markdown table cell: one line, pipes escaped. */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function waitText(seconds: number): string {
  if (seconds >= 3600) return `about ${plural(Math.ceil(seconds / 3600), 'hour')}`;
  return `about ${plural(Math.max(1, Math.ceil(seconds / 60)), 'minute')}`;
}

export function errorText(prefix: string, failure: ApiFailure): string {
  const { code, message, status, retryAfter } = failure.error;
  if (status === 429) {
    // The API's own message may already say "Try again later"; we add the actual wait.
    const base = message.replace(/\s*Try again later[.,]?/i, '').trim();
    const wait = retryAfter !== undefined ? ` You can try again in ${waitText(retryAfter)}.` : '';
    return `${prefix}: rate limited — ${base}${wait}`;
  }
  if (status === 400 || status === 422) return `${prefix}: ${message} (fix the plan and retry)`;
  if (status === 404)
    return `${prefix}: ${message}. Call list_templates to see the available slugs.`;
  return `${prefix}: ${message} [${code}]`;
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function dueCell(t: ScheduledTask): string {
  if (t.deadline === undefined || t.deadline === null) return '—';
  const fit = t.fit;
  if (fit === undefined || fit === null) return t.deadline;
  if (fit.late) return `${t.deadline} (${String(-fit.days)} d late)`;
  if (fit.days === 0) return `${t.deadline} (on time)`;
  return `${t.deadline} (+${String(fit.days)} d)`;
}

export function scheduleTable(schedule: ScheduleSummary): string {
  // The Due column appears only when some task carries a deadline marker.
  const hasDue = schedule.tasks.some((t) => t.deadline !== undefined && t.deadline !== null);
  const rows = schedule.tasks.map((t) => {
    const span = t.isMilestone ? `${t.start} ◆` : `${t.start} → ${t.end}`;
    const days =
      t.isPhase === true
        ? `phase · ${String(t.durationDays)} d`
        : t.isMilestone
          ? 'milestone'
          : `${String(t.durationDays)} d`;
    const flag = t.isCritical
      ? ' ★'
      : t.totalFloat > 0
        ? ` (+${String(t.totalFloat)} d float)`
        : '';
    const due = hasDue ? ` ${dueCell(t)} |` : '';
    return `| ${t.isPhase === true ? '▸ ' : ''}${cell(t.name)}${flag} | ${span} | ${days} |${due}`;
  });
  const header = hasDue ? '| Task | Dates | Duration | Due |' : '| Task | Dates | Duration |';
  const sep = hasDue ? '|---|---|---|---|' : '|---|---|---|';
  return [header, sep, ...rows].join('\n');
}

const CRITICAL_PATH_MAX_NAMES = 20;

export function criticalPathText(schedule: ScheduleSummary): string {
  const byKey = new Map<string, string>();
  for (const t of schedule.tasks) {
    if (t.id !== undefined) byKey.set(t.id, t.name);
    if (t.index !== undefined) byKey.set(String(t.index), t.name);
  }
  const names = schedule.criticalPath.map((k) => cell(byKey.get(String(k)) ?? String(k)));
  if (names.length <= CRITICAL_PATH_MAX_NAMES) return names.join(' → ');
  return `${names.slice(0, CRITICAL_PATH_MAX_NAMES).join(' → ')} → … (+${String(names.length - CRITICAL_PATH_MAX_NAMES)} more)`;
}

function summaryLine(s: ScheduleSummary): string {
  return `Start ${s.projectStartDate} · finish **${s.projectEndDate}** (${plural(s.projectDurationDays, 'working day')}; dates are the first and last working day of each task)`;
}

export interface GanttReplyOptions {
  /** False when the picture could not be produced — the reply must say so. */
  readonly imageAttached: boolean;
}

export function ganttReply(
  res: CreateGanttResponse,
  opts: GanttReplyOptions = { imageAttached: true }
): string {
  const { data } = res;
  const s = data.schedule;
  const fit = data.fit ?? null;
  const fitLine =
    fit === null
      ? ''
      : fit.late
        ? `⚠ Deadline ${fit.deadline}: the plan finishes ${String(-fit.days)} days LATE (${fit.projectEndDate}) — suggest what to shorten or parallelise.`
        : fit.days === 0
          ? `Deadline ${fit.deadline}: the plan finishes exactly on the deadline.`
          : `Deadline ${fit.deadline}: the plan finishes ${String(fit.days)} days early (${fit.projectEndDate}).`;
  const lines = [
    `**${cell(data.name)}** — ${plural(data.taskCount, 'task')}, ${plural(data.dependencyCount, 'dependency', 'dependencies')}`,
    summaryLine(s),
    ...(fitLine !== '' ? [fitLine] : []),
    '',
    scheduleTable(s),
    '',
    `★ Critical path: ${criticalPathText(s)}`,
    '',
    `**Open, export (PNG/PDF) or save the chart:** ${data.claimUrl}`,
    `The link expires on ${fmtDate(data.expiresAt)} (opening it keeps the chart 30 days; saving it to a free LoopGantt account keeps it forever). Share the link with the user — it is the only handle to the chart.`,
  ];
  if (!opts.imageAttached) {
    lines.push(
      '',
      '_The chart picture could not be generated for this plan; the link above shows the full chart._'
    );
  }
  const remaining = res.meta.rateLimit?.remaining;
  if (remaining !== undefined && remaining <= 3) {
    lines.push(
      '',
      `_${plural(remaining, 'more keyless chart')} can be created from this network this hour._`
    );
  }
  return lines.join('\n');
}

export function scheduleReply(s: ScheduleSummary): string {
  return [
    summaryLine(s),
    '',
    scheduleTable(s),
    '',
    `★ Critical path: ${criticalPathText(s)}`,
    '',
    'Nothing was stored. To get a chart the user can open, export and save, call create_gantt with the same plan.',
  ].join('\n');
}

export function templateListReply(res: ListTemplatesResponse): string {
  const lines = res.data.map(
    (t) =>
      `- **${cell(t.name)}** (${t.categoryLabel}, ${plural(t.taskCount, 'task')}, ~${plural(t.estimatedDays, 'day')}) — slug \`${t.slug}\` — ${t.url}`
  );
  return [
    `${plural(res.meta.count, 'industry template')}. Use get_template with a slug to see its task list, adapt it, then call create_gantt.`,
    '',
    ...lines,
  ].join('\n');
}

export function templateReply(t: TemplateDetail): string {
  const rows = t.tasks.map(
    (task) =>
      `| ${String(task.index)} | ${cell(task.name)}${task.isMilestone ? ' ◆' : ''} | ${task.isMilestone ? '—' : `${String(task.duration)} d`} |`
  );
  return [
    `**${cell(t.name)}** — ${t.categoryLabel} · ${plural(t.taskCount, 'task')} · ~${plural(t.estimatedDays, 'day')}`,
    t.description,
    '',
    '| # | Task | Duration |',
    '|---|---|---|',
    ...rows,
    '',
    `Use case: ${t.useCase}`,
    `Template page: ${t.url}`,
    '',
    'Adapt the names, durations and dependencies to the user, then call create_gantt (tasks in order, dependencies as 0-based positions of earlier tasks).',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tool, prompt and resource definitions
// ---------------------------------------------------------------------------

export const GANTT_TASK_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'Task name' },
    duration: {
      type: 'integer',
      minimum: 0,
      description: 'Working days (default 1). 0 makes the task a milestone.',
    },
    isMilestone: { type: 'boolean', description: 'Milestone (zero duration, drawn as a diamond)' },
    isPhase: {
      type: 'boolean',
      description:
        'Top-level phase (a group). Tasks join it with parent = this position. Phases take no dependencies and no parent; their dates become the envelope of their tasks.',
    },
    parent: {
      type: 'integer',
      minimum: 0,
      description:
        'Position (0-based) of an EARLIER task with isPhase=true that this task belongs to',
    },
    description: { type: 'string' },
    deadline: {
      type: 'string',
      description:
        'Finish-by date YYYY-MM-DD for a task with a due date (essay due, exam day, launch). A MARKER: the task is still scheduled normally and the reply reports its fit - buffer or days late.',
    },
    dependencies: {
      type: 'array',
      description:
        'Predecessors: positions (0-based) of EARLIER tasks in this list, or objects { task, type: FS|SS|FF|SF, lag } for typed links / lag in days',
      items: {
        oneOf: [
          { type: 'integer', minimum: 0 },
          {
            type: 'object',
            required: ['task'],
            properties: {
              task: { type: 'integer', minimum: 0 },
              type: { type: 'string', enum: ['FS', 'SS', 'FF', 'SF'] },
              lag: { type: 'integer' },
            },
          },
        ],
      },
    },
  },
} as const;

export const PLAN_PROPERTIES = {
  name: { type: 'string', description: 'Project name' },
  description: { type: 'string', description: 'Optional one-line description' },
  startDate: { type: 'string', description: 'YYYY-MM-DD (defaults to today)' },
  deadline: {
    type: 'string',
    description:
      'Optional deadline YYYY-MM-DD - drawn on the chart; compare with the returned projectEndDate and warn the user if the plan overshoots',
  },
  workDays: {
    type: 'array',
    items: { type: 'integer', minimum: 1, maximum: 7 },
    description: 'Working weekdays as ISO numbers 1 (Mon) … 7 (Sun). Default Mon–Fri.',
  },
  holidays: {
    type: 'array',
    items: { type: 'string' },
    description: 'Non-working dates, YYYY-MM-DD',
  },
  tasks: { type: 'array', minItems: 1, maxItems: 300, items: GANTT_TASK_SCHEMA },
} as const;

export const CREATE_GANTT_TOOL = {
  name: 'create_gantt',
  description:
    'Create a Gantt chart from a task list — no account or API key needed. YOU author the plan: list the tasks in execution order with realistic working-day durations and dependencies (0-based positions of earlier tasks; use { task, type, lag } for start-to-start/finish-to-finish links or lag). Milestones have duration 0. Only add a dependency where a task truly needs another one finished - independent tasks should run in PARALLEL (share a predecessor, or take no dependencies at all and start at the project start). Group tasks into top-level phases for a structured plan/WBS: the phase task gets isPhase: true, its tasks get parent = the position of the phase. LoopGantt schedules it with its critical-path engine and returns a picture of the chart, the dates, the critical path and a link where the user can view, export (PNG/PDF) and save the chart. Always show the user the link. Tasks with a due date take deadline: YYYY-MM-DD (a marker - the reply reports the fit). Use create_gantt when the user wants a chart to open, export or save; use schedule_project instead for what-if date math where nothing should be stored.',
  inputSchema: {
    type: 'object' as const,
    required: ['name', 'tasks'],
    properties: PLAN_PROPERTIES,
  },
};

export const SCHEDULE_TOOL = {
  name: 'schedule_project',
  description:
    'Compute a schedule without storing anything: dates, critical path, float and project end for a task list (same input shape as create_gantt; name optional). Use it to answer "what is the critical path?", "when would this finish?", "how much slack does X have?". Use create_gantt when the user wants a chart they can open.',
  inputSchema: { type: 'object' as const, required: ['tasks'], properties: PLAN_PROPERTIES },
};

export const LIST_TEMPLATES_TOOL = {
  name: 'list_templates',
  description:
    "List LoopGantt's industry project templates with task counts and typical durations. Pick one, fetch it with get_template, adapt it, then create_gantt.",
  inputSchema: { type: 'object' as const, properties: {} },
};

export const GET_TEMPLATE_TOOL = {
  name: 'get_template',
  description:
    'Get one industry template by slug: its task list with durations, ready to adapt and pass to create_gantt.',
  inputSchema: {
    type: 'object' as const,
    required: ['slug'],
    properties: { slug: { type: 'string', description: 'Template slug from list_templates' } },
  },
};

export const CREATE_PROJECT_TOOL = {
  name: 'create_project',
  description:
    'Create a project in the connected LoopGantt ACCOUNT (requires LOOPGANTT_API_KEY). For a keyless chart use create_gantt instead.',
  inputSchema: {
    type: 'object' as const,
    required: ['name', 'tasks'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      startDate: { type: 'string', description: 'YYYY-MM-DD' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            duration: { type: 'number' },
            dependencies: { type: 'array', items: { type: 'number' } },
            description: { type: 'string' },
            isMilestone: { type: 'boolean' },
          },
        },
      },
    },
  },
};

export const LIST_PROJECTS_TOOL = {
  name: 'list_projects',
  description: 'List the projects in the connected LoopGantt account (requires LOOPGANTT_API_KEY).',
  inputSchema: { type: 'object' as const, properties: {} },
};

export const KEYLESS_TOOLS = [
  CREATE_GANTT_TOOL,
  SCHEDULE_TOOL,
  LIST_TEMPLATES_TOOL,
  GET_TEMPLATE_TOOL,
];
export const ACCOUNT_TOOLS = [CREATE_PROJECT_TOOL, LIST_PROJECTS_TOOL];

export const PLAN_PROMPT = {
  name: 'plan_project',
  description:
    'Turn a goal into a scheduled Gantt chart: draft a work breakdown with realistic durations and dependencies, create it with create_gantt, and present the picture, the critical path and the link.',
  arguments: [
    { name: 'goal', description: 'What needs to be delivered', required: true },
    { name: 'deadline', description: 'Target end date (YYYY-MM-DD), if any', required: false },
    { name: 'team_size', description: 'How many people work on it', required: false },
  ],
};

export const TEMPLATE_RESOURCE_TEMPLATE = {
  uriTemplate: `${TEMPLATE_URI_PREFIX}{slug}`,
  name: 'LoopGantt industry template',
  description: 'One industry template with its task list, as JSON (slugs from list_templates)',
  mimeType: 'application/json',
};

export function planPromptText(args: Record<string, unknown>): string {
  const goal = String(args['goal'] ?? '').trim() || '(ask the user what needs to be delivered)';
  const deadline = String(args['deadline'] ?? '').trim();
  const team = String(args['team_size'] ?? '').trim();
  return [
    `Plan this project as a Gantt chart: ${goal}.`,
    deadline !== '' ? `Target end date: ${deadline}.` : '',
    team !== '' ? `Team size: ${team}.` : '',
    '',
    'Steps:',
    '1. If the scope is unclear, ask at most two clarifying questions; otherwise proceed.',
    '2. Draft a work breakdown of 8–25 tasks in execution order with realistic working-day durations, milestones (duration 0) for key checkpoints, and dependencies as 0-based positions of earlier tasks (use { task, type, lag } for start-to-start/finish-to-finish links). Give tasks with a due date a deadline (YYYY-MM-DD).',
    '3. Optionally call list_templates / get_template to start from an industry template.',
    '4. Call create_gantt with the plan (omit startDate unless the user gave one — the server uses today).',
    '5. Show the returned picture, summarise the critical path and the finish date, and give the user the link to open, export or save the chart.',
    deadline !== ''
      ? '6. Compare the computed finish with the target end date: say how much earlier or later it is and, if late, suggest what to shorten or parallelise.'
      : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** A type alias (not an interface): the SDK's result type carries an index
 *  signature, which only object-literal types satisfy implicitly. */
export type ToolReply = {
  content: ToolContent[];
  isError?: boolean;
};

function text(body: string, isError = false): ToolReply {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) };
}

const NO_ACCOUNT_TOOLS =
  'Account tools are not available on this server. Use create_gantt — it needs no account — or run the local server (npm i -g @loopgantt/mcp-server) with LOOPGANTT_API_KEY.';

const MAX_SHOWN_SLUG = 80;

function shownSlug(slug: string): string {
  return slug.length > MAX_SHOWN_SLUG ? `${slug.slice(0, MAX_SHOWN_SLUG - 3)}…` : slug;
}

/** The token is the last path segment of the claim link (query/hash/trailing slash tolerated). */
export function claimTokenFromUrl(claimUrl: string): string {
  const path = claimUrl.split(/[?#]/)[0] ?? '';
  return path.replace(/\/+$/, '').split('/').pop() ?? '';
}

export async function callTool(
  backend: McpBackend,
  name: string,
  rawArgs: Record<string, unknown> | undefined
): Promise<ToolReply> {
  const args = rawArgs ?? {};

  if (name === 'create_gantt') {
    const result = await backend.createGantt(args as unknown as PlanRequest);
    if (isFailure(result)) return text(errorText('Could not create the Gantt chart', result), true);
    const content: ToolContent[] = [];
    const token = claimTokenFromUrl(result.data.claimUrl);
    const png = token !== '' ? await backend.fetchImageBase64(token) : null;
    if (png !== null) content.push({ type: 'image', data: png, mimeType: 'image/png' });
    content.push({ type: 'text', text: ganttReply(result, { imageAttached: png !== null }) });
    return { content };
  }

  if (name === 'schedule_project') {
    const result = await backend.schedule(args as unknown as PlanRequest);
    if (isFailure(result)) return text(errorText('Could not schedule the plan', result), true);
    return text(scheduleReply(result.data));
  }

  if (name === 'list_templates') {
    const result = await backend.listTemplates();
    if (isFailure(result)) return text(errorText('Could not list templates', result), true);
    return text(templateListReply(result));
  }

  if (name === 'get_template') {
    const slug = String(args['slug'] ?? '').trim();
    if (slug === '') return text('get_template needs a slug (see list_templates).', true);
    const result = await backend.getTemplate(slug);
    if (isFailure(result)) {
      return text(errorText(`Could not load template "${shownSlug(slug)}"`, result), true);
    }
    return text(templateReply(result.data));
  }

  if (name === 'create_project') {
    if (backend.createProject === undefined) return text(NO_ACCOUNT_TOOLS, true);
    const result = await backend.createProject(args as unknown as CreateProjectRequest);
    if (isFailure(result)) return text(errorText('Could not create the project', result), true);
    const { data, meta } = result;
    return text(
      [
        `Project created: **${cell(data.name)}**`,
        `- Tasks: ${String(data.taskCount)} · Dependencies: ${String(data.dependencyCount)} · Start: ${data.startDate}`,
        `**Open it:** ${data.url}`,
        meta.message,
      ].join('\n')
    );
  }

  if (name === 'list_projects') {
    if (backend.listProjects === undefined) return text(NO_ACCOUNT_TOOLS, true);
    const result = await backend.listProjects();
    if (isFailure(result)) return text(errorText('Could not list projects', result), true);
    if (result.data.length === 0) {
      return text('No projects yet. Use create_gantt (no account needed) or create_project.');
    }
    const list = result.data
      .map((p, i) => `${String(i + 1)}. **${cell(p.name)}** (${p.status})\n   ${p.url}`)
      .join('\n\n');
    return text(`Found ${plural(result.meta.count, 'project')}:\n\n${list}`);
  }

  const available = KEYLESS_TOOLS.map((t) => t.name).join(', ');
  return text(`Unknown tool "${name}". Available tools: ${available}.`, true);
}

/**
 * Register every MCP handler on a low-level `Server`. `keyed` controls whether
 * the account tools are LISTED; calling them on a backend without them yields
 * a plain-language error, never a crash.
 */
export function attachHandlers(
  server: Server,
  backend: McpBackend,
  opts: { keyed: boolean }
): void {
  const tools = opts.keyed ? [...KEYLESS_TOOLS, ...ACCOUNT_TOOLS] : KEYLESS_TOOLS;

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, (request) =>
    callTool(backend, request.params.name, request.params.arguments)
  );

  // Resources: the industry templates, readable as JSON.
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const result = await backend.listTemplates();
    if (isFailure(result)) return { resources: [] };
    return {
      resources: result.data.map((t) => ({
        uri: `${TEMPLATE_URI_PREFIX}${t.slug}`,
        name: t.name,
        description: `${t.categoryLabel} template — ${plural(t.taskCount, 'task')}, ~${plural(t.estimatedDays, 'day')}`,
        mimeType: 'application/json',
      })),
    };
  });

  // Clients that see the `resources` capability also ask for URI templates.
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates: [TEMPLATE_RESOURCE_TEMPLATE],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (!uri.startsWith(TEMPLATE_URI_PREFIX)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
    }
    const slug = uri.slice(TEMPLATE_URI_PREFIX.length);
    const result = await backend.getTemplate(slug);
    if (isFailure(result)) throw new McpError(ErrorCode.InvalidParams, result.error.message);
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result.data, null, 2) }],
    };
  });

  // Prompt: a guided "goal → chart" flow.
  server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: [PLAN_PROMPT] }));

  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    if (request.params.name !== PLAN_PROMPT.name) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
    }
    return {
      description: PLAN_PROMPT.description,
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: planPromptText(request.params.arguments ?? {}) },
        },
      ],
    };
  });
}
