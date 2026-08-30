#!/usr/bin/env node

/**
 * LoopGantt MCP Server (stdio)
 *
 * Lets any MCP client (Claude Desktop, Cursor, …) turn a plain-language plan
 * into a real Gantt chart on LoopGantt.
 *
 * Keyless (default): `create_gantt`, `schedule_project`, `list_templates` and
 * `get_template` need no account and no API key. A created chart is stored as
 * an unclaimed project; the reply carries the schedule (dates + critical
 * path), a picture of the chart and a link where the user can view it,
 * export it (PNG / PDF) and save it to a free account.
 *
 * With an API key (`LOOPGANTT_API_KEY`, from https://loopgantt.com/settings/api-keys)
 * the account tools `create_project` and `list_projects` are enabled too.
 *
 * The same tools are hosted at https://loopgantt.com/api/mcp (Streamable HTTP,
 * no install) — this package is the local alternative and the only way to use
 * the account tools until the remote endpoint gets OAuth. Both servers share
 * the catalog in ./shared/catalog.ts; this file is just the HTTP backend.
 *
 * Setup (keyless):
 *   npm install -g @loopgantt/mcp-server
 *   claude_desktop_config.json → { "mcpServers": { "loopgantt": { "command": "loopgantt-mcp" } } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  attachHandlers,
  isPngResponse,
  MCP_VERSION,
  responseToResult,
  SERVER_CAPABILITIES,
  SERVER_INFO,
  SERVER_INSTRUCTIONS,
  type ApiFailure,
  type CreateGanttResponse,
  type CreateProjectResponse,
  type ListProjectsResponse,
  type ListTemplatesResponse,
  type McpBackend,
  type ScheduleResponse,
  type TemplateResponse,
} from './shared/catalog.js';

const API_BASE_URL = (process.env.LOOPGANTT_API_URL ?? 'https://loopgantt.com/api/v1').replace(
  /\/+$/,
  ''
);
const API_KEY = process.env.LOOPGANTT_API_KEY;
const HAS_KEY = typeof API_KEY === 'string' && API_KEY.trim() !== '';
/** Identifies this client to the API (unread today; reserved for aggregate stats). */
const CLIENT_HEADER = `mcp-stdio/${MCP_VERSION}`;
const REQUEST_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// HTTP backend
// ---------------------------------------------------------------------------

async function apiCall<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; auth?: boolean }
): Promise<T | ApiFailure> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-LoopGantt-Client': CLIENT_HEADER,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth === true) {
    if (!HAS_KEY) {
      return {
        error: {
          code: 'NO_API_KEY',
          message:
            'This tool needs a LoopGantt API key. Set LOOPGANTT_API_KEY (https://loopgantt.com/settings/api-keys) — or use create_gantt, which needs no account.',
          status: 0,
        },
      };
    }
    headers['Authorization'] = `Bearer ${API_KEY ?? ''}`;
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    return {
      error: {
        code: 'NETWORK',
        message: `Could not reach LoopGantt (${err instanceof Error ? err.message : String(err)})`,
        status: 0,
      },
    };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return responseToResult<T>({
    ok: response.ok,
    status: response.status,
    json,
    retryAfter: response.headers.get('Retry-After'),
  });
}

/**
 * The picture is fetched from the same API base this server talks to (the
 * API's absolute imageUrl is the public origin, which a self-hosted or local
 * API may not be reachable as).
 */
async function fetchImageBase64(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/gantt/${encodeURIComponent(token)}/image.png`, {
      headers: { Accept: 'image/png', 'X-LoopGantt-Client': CLIENT_HEADER },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!isPngResponse(res.ok, res.headers.get('content-type'))) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return Buffer.from(bytes).toString('base64');
  } catch {
    return null;
  }
}

const httpBackend: McpBackend = {
  createGantt: (body) => apiCall<CreateGanttResponse>('/gantt', { method: 'POST', body }),
  schedule: (body) => apiCall<ScheduleResponse>('/schedule', { method: 'POST', body }),
  listTemplates: () => apiCall<ListTemplatesResponse>('/templates', { method: 'GET' }),
  getTemplate: (slug) =>
    apiCall<TemplateResponse>(`/templates/${encodeURIComponent(slug)}`, { method: 'GET' }),
  fetchImageBase64,
  // Always wired: without a key the call explains how to get one (and points
  // at create_gantt); the tools are only LISTED when a key is present.
  createProject: (body) =>
    apiCall<CreateProjectResponse>('/projects', { method: 'POST', body, auth: true }),
  listProjects: () => apiCall<ListProjectsResponse>('/projects', { method: 'GET', auth: true }),
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new Server(SERVER_INFO, {
  capabilities: SERVER_CAPABILITIES,
  instructions: SERVER_INSTRUCTIONS,
});
attachHandlers(server, httpBackend, { keyed: HAS_KEY });

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `LoopGantt MCP server ${MCP_VERSION} running (${HAS_KEY ? 'account tools enabled' : 'keyless mode'})`
  );
}

main().catch((error: unknown) => {
  console.error('Server error:', error);
  process.exit(1);
});
