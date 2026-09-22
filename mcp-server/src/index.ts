#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = process.env.LOCAL_PM_URL || 'http://localhost:3010';

/**
 * Optional API key of the acting account (Users API key). When set, every
 * call is authenticated and the server scopes list/get responses to the
 * linked member's projects (install-admin accounts see everything). When
 * unset the server's LOCAL_PM_REQUIRE_AUTH setting governs access.
 */
const API_KEY = process.env.LOCAL_PM_API_KEY || '';

const STATUS_MAP: Record<string, string> = {
  planned: 'PLANNED',
  active: 'ACTIVE',
  on_hold: 'ON_HOLD',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  no_priority: 'NO_PRIORITY',
  urgent: 'URGENT',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

const TSHIRT_POINTS: Record<string, number> = { xs: 1, s: 2, m: 3, l: 5, xl: 8 };

function resolveEstimate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    const size = TSHIRT_POINTS[value.trim().toLowerCase()];
    if (size) return size;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  return rounded > 0 ? Math.min(rounded, 1000) : null;
}

interface StatusDoc {
  id: string;
  name: string;
  key: string;
  type: string;
  order?: number;
  project?: { id: string } | string | null;
}

let statusCache: { at: number; docs: StatusDoc[] } | null = null;

async function loadStatuses(): Promise<StatusDoc[]> {
  if (statusCache && Date.now() - statusCache.at < 30000) return statusCache.docs;
  const response = (await apiRequest('/statuses?limit=200&depth=0')) as { docs?: StatusDoc[] };
  const docs = response.docs ?? [];
  statusCache = { at: Date.now(), docs };
  return docs;
}

function statusesForProject(docs: StatusDoc[], projectId?: string): StatusDoc[] {
  const sorted = [...docs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const globals = sorted.filter((doc) => !doc.project);
  if (!projectId) return globals;

  const scoped = sorted.filter((doc) => {
    const project = doc.project;
    if (!project) return false;
    return (typeof project === 'string' ? project : project.id) === projectId;
  });

  return [...globals, ...scoped].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function resolveStatusId(value: string | undefined, projectId?: string): Promise<string | undefined> {
  if (!value) return undefined;
  const docs = await loadStatuses();
  const scope = statusesForProject(docs, projectId);
  const needle = value.trim().toLowerCase();
  const match =
    scope.find((doc) => doc.id === value) ??
    scope.find((doc) => doc.key.toLowerCase() === needle) ??
    scope.find((doc) => doc.name.toLowerCase() === needle) ??
    docs.find((doc) => doc.id === value);
  if (!match) {
    const known = scope.map((doc) => doc.key).join(', ');
    throw new Error(`Unknown status "${value}". Available statuses: ${known || '(none configured)'}`);
  }
  return match.id;
}

async function defaultStatusId(projectId?: string): Promise<string | undefined> {
  const scope = statusesForProject(await loadStatuses(), projectId);
  return scope[0]?.id;
}

interface LabelDoc {
  id: string;
  name: string;
  key: string;
  color?: string;
  group?: { id: string; name?: string } | string | null;
}

let labelCache: { at: number; docs: LabelDoc[] } | null = null;

async function loadLabels(refresh = false): Promise<LabelDoc[]> {
  if (!refresh && labelCache && Date.now() - labelCache.at < 30000) return labelCache.docs;
  const response = (await apiRequest('/labels?limit=500&depth=1')) as { docs?: LabelDoc[] };
  const docs = response.docs ?? [];
  labelCache = { at: Date.now(), docs };
  return docs;
}

function labelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function matchLabel(docs: LabelDoc[], value: string): LabelDoc | undefined {
  const needle = value.trim().toLowerCase();
  return (
    docs.find((doc) => doc.id === value) ??
    docs.find((doc) => doc.key.toLowerCase() === needle) ??
    docs.find((doc) => doc.name.trim().toLowerCase() === needle) ??
    docs.find((doc) => doc.key === labelKey(value))
  );
}

async function resolveLabelIds(values: unknown): Promise<string[] | undefined> {
  if (values === undefined || values === null) return undefined;
  if (!Array.isArray(values)) throw new Error('labels must be an array of label names, keys or ids');

  const names = values
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && 'name' in (entry as Record<string, unknown>)) {
        return String((entry as { name: unknown }).name);
      }
      return '';
    })
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (names.length === 0) return [];

  let docs = await loadLabels();
  const ids: string[] = [];

  for (const name of names) {
    let match = matchLabel(docs, name);

    if (!match) {
      docs = await loadLabels(true);
      match = matchLabel(docs, name);
    }

    if (!match) {
      const created = (await apiRequest('/labels', 'POST', { name })) as { doc?: LabelDoc };
      if (!created.doc) throw new Error(`Could not create the label "${name}"`);
      match = created.doc;
      labelCache = { at: Date.now(), docs: [...docs, match] };
      docs = labelCache.docs;
    }

    if (!ids.includes(match.id)) ids.push(match.id);
  }

  return ids;
}

function slimLabels(labels: unknown): string[] | null {
  if (!Array.isArray(labels)) return null;
  return labels
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        return (record.name ?? record.id) as string;
      }
      return '';
    })
    .filter(Boolean) as string[];
}

function toPayloadValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return STATUS_MAP[value] || value;
}

interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    nextPage: number | null;
    prevPage: number | null;
  };
}

function toCycleDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

function cycleStateOf(cycle: Record<string, unknown>): string {
  if (cycle.completedAt) return 'completed';
  const today = new Date().toISOString().slice(0, 10);
  const startsAt = typeof cycle.startsAt === 'string' ? cycle.startsAt.slice(0, 10) : '';
  const endsAt = typeof cycle.endsAt === 'string' ? cycle.endsAt.slice(0, 10) : '';
  if (startsAt && today < startsAt) return 'upcoming';
  if (endsAt && today > endsAt) return 'completed';
  return 'active';
}

function formatPaginatedResponse<T>(
  response: {
    docs: T[];
    totalDocs: number;
    limit: number;
    totalPages: number;
    page: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    nextPage?: number | null;
    prevPage?: number | null;
  }
): PaginatedResponse<T> {
  return {
    items: response.docs,
    pagination: {
      page: response.page,
      limit: response.limit,
      totalItems: response.totalDocs,
      totalPages: response.totalPages,
      hasNextPage: response.hasNextPage,
      hasPrevPage: response.hasPrevPage,
      nextPage: response.hasNextPage ? response.page + 1 : null,
      prevPage: response.hasPrevPage ? response.page - 1 : null,
    },
  };
}

interface SlimProject {
  id: string;
  prefix: string;
}

interface SlimTeam {
  id: string;
  name: string;
}

function slimProject(project: unknown): SlimProject | string | null {
  if (!project) return null;
  if (typeof project === 'string') return project;
  if (typeof project === 'object' && project !== null) {
    const p = project as Record<string, unknown>;
    return {
      id: p.id as string,
      prefix: p.prefix as string,
    };
  }
  return null;
}

function slimTeam(team: unknown): SlimTeam | string | null {
  if (!team) return null;
  if (typeof team === 'string') return team;
  if (typeof team === 'object' && team !== null) {
    const t = team as Record<string, unknown>;
    return {
      id: t.id as string,
      name: t.name as string,
    };
  }
  return null;
}

function slimComment(comment: unknown): string | null {
  if (!comment) return null;
  if (typeof comment === 'string') return comment;
  if (typeof comment === 'object' && comment !== null) {
    return (comment as Record<string, unknown>).id as string;
  }
  return null;
}

interface SlimMember {
  id: string;
  name: string;
}

function slimMember(member: unknown): SlimMember | string | null {
  if (!member) return null;
  if (typeof member === 'string') return member;
  if (typeof member === 'object' && member !== null) {
    const m = member as Record<string, unknown>;
    return {
      id: m.id as string,
      name: m.name as string,
    };
  }
  return null;
}

interface SlimCycle {
  id: string;
  name: string;
  number: number;
}

function slimCycle(cycle: unknown): SlimCycle | string | null {
  if (!cycle) return null;
  if (typeof cycle === 'string') return cycle;
  if (typeof cycle === 'object' && cycle !== null) {
    const c = cycle as Record<string, unknown>;
    return {
      id: c.id as string,
      name: c.name as string,
      number: c.number as number,
    };
  }
  return null;
}

function slimBlockedBy(blockedBy: unknown): string[] | null {
  if (!blockedBy) return null;
  if (!Array.isArray(blockedBy)) return null;
  return blockedBy.map(item => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
      return (item as Record<string, unknown>).id as string;
    }
    return item;
  }).filter(Boolean) as string[];
}

interface EpicRollup {
  total: number;
  done: number;
  cancelled: number;
  started: number;
  open: number;
  counted: number;
  percent: number;
}

function statusTypeOf(status: unknown): string | null {
  if (!status || typeof status !== 'object') return null;
  const type = (status as Record<string, unknown>).type;
  return typeof type === 'string' ? type : null;
}

function rollupEpic(children: Array<Record<string, unknown>>): EpicRollup {
  let done = 0;
  let cancelled = 0;
  let started = 0;

  for (const child of children) {
    const type = statusTypeOf(child.status);
    if (type === 'COMPLETED') done += 1;
    else if (type === 'CANCELLED') cancelled += 1;
    else if (type === 'STARTED') started += 1;
  }

  const total = children.length;
  const counted = total - cancelled;

  return {
    total,
    done,
    cancelled,
    started,
    open: counted - done,
    counted,
    percent: counted > 0 ? Math.round((done / counted) * 100) : 0,
  };
}


interface InitiativeProjectRollup {
  id: string;
  name: string;
  prefix: string | null;
  total: number;
  done: number;
  cancelled: number;
  started: number;
  percent: number;
}

interface InitiativeRollup {
  projects: number;
  total: number;
  done: number;
  cancelled: number;
  started: number;
  open: number;
  counted: number;
  percent: number;
}

function initiativeProjectIds(initiative: Record<string, unknown>): string[] {
  const projects = initiative.projects;
  if (!Array.isArray(projects)) return [];

  const seen = new Set<string>();
  for (const entry of projects) {
    if (!entry) continue;
    seen.add(typeof entry === 'object' ? String((entry as { id: unknown }).id) : String(entry));
  }
  return [...seen];
}

async function countTickets(projectId: string, statusIds?: string[]): Promise<number> {
  if (statusIds && statusIds.length === 0) return 0;
  let query = `?limit=0&depth=0&where[project][equals]=${projectId}`;
  if (statusIds) query += `&where[status][in]=${statusIds.join(',')}`;
  const response = (await apiRequest(`/tickets${query}`)) as { totalDocs?: number };
  return response.totalDocs ?? 0;
}

async function rollupInitiativeProjects(
  projects: Array<Record<string, unknown>>
): Promise<InitiativeProjectRollup[]> {
  const statuses = await loadStatuses();

  return Promise.all(
    projects.map(async (project) => {
      const id = String(project.id);
      const scope = statusesForProject(statuses, id);
      const idsOfType = (type: string) =>
        scope.filter((status) => status.type === type).map((status) => status.id);

      const [total, done, cancelled, started] = await Promise.all([
        countTickets(id),
        countTickets(id, idsOfType('COMPLETED')),
        countTickets(id, idsOfType('CANCELLED')),
        countTickets(id, idsOfType('STARTED')),
      ]);

      const counted = total - cancelled;

      return {
        id,
        name: (project.name as string) ?? id,
        prefix: (project.prefix as string) ?? null,
        total,
        done,
        cancelled,
        started,
        percent: counted > 0 ? Math.round((done / counted) * 100) : 0,
      };
    })
  );
}

function rollupInitiative(projects: InitiativeProjectRollup[]): InitiativeRollup {
  let total = 0;
  let done = 0;
  let cancelled = 0;
  let started = 0;

  for (const project of projects) {
    total += project.total;
    done += project.done;
    cancelled += project.cancelled;
    started += project.started;
  }

  const counted = total - cancelled;

  return {
    projects: projects.length,
    total,
    done,
    cancelled,
    started,
    open: counted - done,
    counted,
    percent: counted > 0 ? Math.round((done / counted) * 100) : 0,
  };
}

async function loadInitiative(id: string): Promise<Record<string, unknown>> {
  return (await apiRequest(`/initiatives/${id}?depth=1`)) as Record<string, unknown>;
}

async function setInitiativeProjects(id: string, projectIds: string[]): Promise<unknown> {
  return apiRequest(`/initiatives/${id}`, 'PATCH', { projects: projectIds });
}

interface SlimEpic {
  id: string;
  ticketId: string | null;
  title: string;
}

function slimEpic(epic: unknown): SlimEpic | string | null {
  if (!epic) return null;
  if (typeof epic === 'string') return epic;
  if (typeof epic === 'object' && epic !== null) {
    const e = epic as Record<string, unknown>;
    return {
      id: e.id as string,
      ticketId: (e.ticketId as string) ?? null,
      title: e.title as string,
    };
  }
  return null;
}

function slimTicket(ticket: Record<string, unknown>, fieldsToInclude: Set<string>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  for (const field of fieldsToInclude) {
    if (!(field in ticket)) continue;

    const value = ticket[field];

    if (field === 'project') {
      filtered[field] = slimProject(value);
    } else if (field === 'team') {
      filtered[field] = slimTeam(value);
    } else if (field === 'assignee') {
      filtered[field] = slimMember(value);
    } else if (field === 'cycle') {
      filtered[field] = slimCycle(value);
    } else if (field === 'blockedBy') {
      filtered[field] = slimBlockedBy(value);
    } else if (field === 'epic') {
      filtered[field] = slimEpic(value);
    } else if (field === 'labels') {
      filtered[field] = slimLabels(value);
    } else {
      filtered[field] = value;
    }
  }

  return filtered;
}

async function apiRequest(
  endpoint: string,
  method: string = 'GET',
  body?: unknown
): Promise<unknown> {
  const url = `${BASE_URL}/api${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) {
    headers.Authorization = `users API-Key ${API_KEY}`;
  }
  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API request failed: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Workspace scoping (task 41): resolve the acting account's visible projects.
 * Returns null when the actor sees everything (no API key, auth off, or an
 * install-admin account); otherwise the concrete project ID list. The lists
 * cache briefly so tool bursts do not re-fetch membership per call.
 */
let membershipCache: { at: number; all: boolean; ids: string[] } | null = null;

async function visibleProjectIds(): Promise<{ all: boolean; ids: string[] } | null> {
  if (!API_KEY) return null;
  if (membershipCache && Date.now() - membershipCache.at < 15000) {
    return { all: membershipCache.all, ids: membershipCache.ids };
  }

  try {
    const me = (await apiRequest('/users/me')) as { user?: { id?: string; role?: string } };
    const user = me?.user;
    if (!user?.id) return { all: false, ids: [] };
    if (user.role === 'admin') {
      membershipCache = { at: Date.now(), all: true, ids: [] };
      return { all: true, ids: [] };
    }

    const query = new URLSearchParams({ limit: '1', depth: '0' });
    query.set('where[user][equals]', String(user.id));
    const found = (await apiRequest(`/members?${query}`)) as {
      docs?: Array<{ projects?: Array<string | { id?: string }>[] | string[] | null }>;
    };
    const member = found.docs?.[0];
    const refs = (member?.projects ?? []) as Array<string | { id?: string }>;
    const ids = refs
      .map((ref) => (typeof ref === 'string' ? ref : ref?.id))
      .filter((id): id is string => Boolean(id));
    membershipCache = { at: Date.now(), all: false, ids };
    return { all: false, ids };
  } catch {
    // Fail closed: an unresolvable actor sees nothing rather than everything.
    membershipCache = { at: Date.now(), all: false, ids: [] };
    return { all: false, ids: [] };
  }
}

/** Where-fragment limiting a project field to the actor's grants. */
async function projectScopeParam(field = 'project'): Promise<string> {
  const scope = await visibleProjectIds();
  if (!scope || scope.all) return '';
  if (scope.ids.length === 0) {
    // No grants: constrain to an impossible ID so the list comes back empty
    // instead of leaking rows the actor cannot open.
    return `&where[${field}][equals]=__no_access__`;
  }
  return `&where[${field}][in]=${scope.ids.join(',')}`;
}

/** Per-document check for get_* tools: may the actor open this project's content? */
async function mayOpenProject(projectId: string | null | undefined): Promise<boolean> {
  if (!projectId) return false;
  const scope = await visibleProjectIds();
  if (!scope || scope.all) return true;
  return scope.ids.includes(String(projectId));
}

/**
 * Comments and activity hang off a ticket; the ticket's project decides.
 * Resolves the ticket then applies the same per-document check.
 */
async function mayOpenTicketThroughProject(ticketId: string | null | undefined): Promise<boolean> {
  if (!ticketId) return false;
  const scope = await visibleProjectIds();
  if (!scope || scope.all) return true;
  try {
    const ticket = (await apiRequest(`/tickets/${ticketId}?depth=0`)) as Record<string, unknown>;
    return mayOpenProject(projectIdOf(ticket.project));
  } catch {
    return false;
  }
}

function projectIdOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const id = (value as { id: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  return null;
}

const tools: Tool[] = [
  {
    name: 'list_projects',
    description: 'List all projects in Local PM. By default returns only basic fields (id, name, prefix, status, color, icon). Use "include" to request additional fields like description.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status: active, on_hold, completed, cancelled',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of projects to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, prefix, status, color, icon are returned.',
          items: {
            type: 'string',
            enum: ['description', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_project',
    description: 'Get detailed information about a specific project by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The project ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project in Local PM',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name',
        },
        prefix: {
          type: 'string',
          description: 'Project prefix (2-6 uppercase letters, used for ticket IDs like PROJ-1)',
        },
        description: {
          type: 'string',
          description: 'Project description (supports HTML for rich text)',
        },
        status: {
          type: 'string',
          description: 'Project status',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
          default: 'active',
        },
        icon: {
          type: 'string',
          description: 'Icon name: folder, rocket, zap, star, heart, flag, target, briefcase, code, box, layers, database',
          default: 'folder',
        },
        color: {
          type: 'string',
          description: 'Hex color code (e.g., #6366f1)',
          default: '#6366f1',
        },
        startDate: {
          type: 'string',
          description: 'Start date in ISO format (YYYY-MM-DD). Must not fall after targetDate.',
        },
        targetDate: {
          type: 'string',
          description: 'Target completion date in ISO format (YYYY-MM-DD)',
        },
      },
      required: ['name', 'prefix'],
    },
  },
  {
    name: 'update_project',
    description: 'Update an existing project',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The project ID to update',
        },
        name: {
          type: 'string',
          description: 'New project name',
        },
        description: {
          type: 'string',
          description: 'New project description',
        },
        status: {
          type: 'string',
          description: 'New project status',
          enum: ['active', 'on_hold', 'completed', 'cancelled'],
        },
        icon: {
          type: 'string',
          description: 'New icon name',
        },
        color: {
          type: 'string',
          description: 'New hex color code',
        },
        startDate: {
          type: 'string',
          description: 'New start date in ISO format (use null to clear). Must not fall after targetDate.',
        },
        targetDate: {
          type: 'string',
          description: 'New target date in ISO format (use null to clear)',
        },
        estimates: {
          type: 'object',
          description:
            'Effort estimate settings. Turning estimates on makes the cycle burndown and velocity charts count points rather than tickets.',
          properties: {
            enabled: {
              type: 'boolean',
              description: 'Whether tickets in this project carry an estimate',
            },
            scale: {
              type: 'string',
              description:
                'How estimates are written. T-shirt sizes map onto the fibonacci values, so every scale still sums.',
              enum: ['linear', 'fibonacci', 'exponential', 'tshirt'],
            },
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project and optionally all its tickets',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The project ID to delete',
        },
        deleteTickets: {
          type: 'boolean',
          description: 'Whether to delete all tickets in the project (default: true)',
          default: true,
        },
      },
      required: ['id'],
    },
  },

  {
    name: 'list_initiatives',
    description: 'List initiatives — the layer above projects that rolls several of them up under one objective. Returns id, name, status, targetDate, projectCount, color and icon by default.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['planned', 'active', 'completed', 'cancelled'],
        },
        project: {
          type: 'string',
          description: 'Only initiatives that contain this project id',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of initiatives to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1)',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response',
          items: {
            type: 'string',
            enum: ['description', 'lead', 'projects', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_initiative',
    description: 'Get one initiative with its projects and rolled-up ticket progress. Cancelled tickets stay in the total but leave the denominator, so percent reflects work that can still be finished.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The initiative ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_initiative',
    description: 'Create an initiative. Projects can be attached now or added later with add_project_to_initiative.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'What this initiative is trying to achieve',
        },
        description: {
          type: 'string',
          description: 'Initiative description (supports HTML for rich text)',
        },
        status: {
          type: 'string',
          description: 'Initiative status',
          enum: ['planned', 'active', 'completed', 'cancelled'],
          default: 'planned',
        },
        projects: {
          type: 'array',
          description: 'Project ids this initiative rolls up',
          items: { type: 'string' },
        },
        lead: {
          type: 'string',
          description: 'Member id accountable for this initiative',
        },
        targetDate: {
          type: 'string',
          description: 'The date this initiative is aiming at (ISO 8601)',
        },
        icon: {
          type: 'string',
          description: 'Icon name: target, rocket, flag, star, zap, layers, briefcase, megaphone, heart, cloud',
          default: 'target',
        },
        color: {
          type: 'string',
          description: 'Hex color code (e.g., #6366f1)',
          default: '#6366f1',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_initiative',
    description: 'Update an initiative. Passing "projects" replaces the whole list — use add_project_to_initiative or remove_project_from_initiative to change one membership.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The initiative ID to update',
        },
        name: { type: 'string', description: 'New name' },
        description: { type: 'string', description: 'New description' },
        status: {
          type: 'string',
          description: 'New status',
          enum: ['planned', 'active', 'completed', 'cancelled'],
        },
        projects: {
          type: 'array',
          description: 'Replaces the full list of project ids',
          items: { type: 'string' },
        },
        lead: { type: 'string', description: 'New lead member id, or empty string to clear it' },
        targetDate: { type: 'string', description: 'New target date (ISO 8601), or empty string to clear it' },
        icon: { type: 'string', description: 'New icon name' },
        color: { type: 'string', description: 'New hex color code' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_initiative',
    description: 'Delete an initiative. The projects inside it are kept — only the grouping is removed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The initiative ID to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_project_to_initiative',
    description: 'Add one project to an initiative, leaving its other projects alone. A project can belong to several initiatives.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The initiative ID',
        },
        project: {
          type: 'string',
          description: 'The project ID to add',
        },
      },
      required: ['id', 'project'],
    },
  },
  {
    name: 'remove_project_from_initiative',
    description: 'Remove one project from an initiative. The project itself and its tickets are untouched.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The initiative ID',
        },
        project: {
          type: 'string',
          description: 'The project ID to remove',
        },
      },
      required: ['id', 'project'],
    },
  },

  {
    name: 'list_teams',
    description: 'List all teams in Local PM. By default returns only basic fields (id, name, color). Use "include" to request additional fields like description.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of teams to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, color are returned.',
          items: {
            type: 'string',
            enum: ['description', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_team',
    description: 'Get detailed information about a specific team by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_team',
    description: 'Create a new team in Local PM',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Team name',
        },
        description: {
          type: 'string',
          description: 'Team description (supports HTML for rich text)',
        },
        color: {
          type: 'string',
          description: 'Hex color code (e.g., #6366f1)',
          default: '#6366f1',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_team',
    description: 'Update an existing team',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team ID to update',
        },
        name: {
          type: 'string',
          description: 'New team name',
        },
        description: {
          type: 'string',
          description: 'New team description',
        },
        color: {
          type: 'string',
          description: 'New hex color code',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_team',
    description: 'Delete a team (tickets assigned to this team will become unassigned)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The team ID to delete',
        },
      },
      required: ['id'],
    },
  },

  {
    name: 'list_cycles',
    description: 'List cycles (time-boxed sprints) in Local PM. Cycles belong to a project and are numbered sequentially. Filter by project and by state.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Only return cycles belonging to this project ID',
        },
        state: {
          type: 'string',
          description: 'Filter by cycle state, derived from the dates and whether the cycle was closed',
          enum: ['active', 'upcoming', 'completed'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of cycles to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1)',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include. By default id, name, number, startsAt, endsAt, completedAt and state are returned.',
          items: {
            type: 'string',
            enum: ['goal', 'rolledOver', 'project', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_cycle',
    description: 'Get a single cycle by ID, including how many tickets it holds and how many are done',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The cycle ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_cycle',
    description: 'Create a cycle on a project. Normally cycles are provisioned automatically — use this only to add one by hand.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'The project ID this cycle belongs to',
        },
        number: {
          type: 'number',
          description: 'Sequential cycle number within the project. Must be unused.',
        },
        startsAt: {
          type: 'string',
          description: 'First day of the cycle, as YYYY-MM-DD',
        },
        endsAt: {
          type: 'string',
          description: 'Last day of the cycle, inclusive, as YYYY-MM-DD',
        },
        name: {
          type: 'string',
          description: 'Display name. Defaults to "Cycle <number>".',
        },
        goal: {
          type: 'string',
          description: 'Optional one-line goal for the cycle',
        },
      },
      required: ['project', 'number', 'startsAt', 'endsAt'],
    },
  },
  {
    name: 'update_cycle',
    description: 'Update a cycle name, goal or dates',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The cycle ID to update',
        },
        name: {
          type: 'string',
          description: 'New display name',
        },
        goal: {
          type: 'string',
          description: 'New goal for the cycle',
        },
        startsAt: {
          type: 'string',
          description: 'New first day, as YYYY-MM-DD',
        },
        endsAt: {
          type: 'string',
          description: 'New last day, inclusive, as YYYY-MM-DD',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_cycle',
    description: 'Delete a cycle. Tickets in it are not deleted — they are left without a cycle.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The cycle ID to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_cycle_burndown',
    description:
      'Day-by-day burndown for a cycle: scope, completed and remaining work per day, against the ideal line. Rebuilt from the ticket history, so scope added or removed mid-cycle shows on the day it happened. A closed cycle reads from the snapshot frozen when it closed. Counts points when the project has estimates enabled, tickets otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The cycle ID',
        },
        live: {
          type: 'boolean',
          description:
            'Recompute a closed cycle from the current history instead of reading its frozen snapshot (default: false)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_velocity',
    description:
      'What each closed cycle in a project committed to against what it finished, plus the average completed and the share of committed work delivered. Counts points when the project has estimates enabled, tickets otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project ID',
        },
        window: {
          type: 'number',
          description: 'How many recent closed cycles to include (default: 6)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'close_cycle',
    description: 'Close a cycle now and roll its unfinished tickets on according to the project rollover setting (next cycle, backlog, or leave them).',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The cycle ID to close',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'reconcile_cycles',
    description: 'Provision any missing cycles and, for projects set to automatic rollover, close the cycles whose end date has passed. Idempotent.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Limit the run to one project. Omit to reconcile every project with cycles enabled.',
        },
      },
    },
  },

  {
    name: 'list_members',
    description: 'List the people tickets can be assigned to. By default returns only basic fields (id, name, active). Use "include" to request email, team or timestamps. Members are distinct from login accounts: a member is a person work is assigned to.',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: {
          type: 'string',
          description: 'Filter by team ID',
        },
        activeOnly: {
          type: 'boolean',
          description: 'Only return people who are still active (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of members to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, name, active are returned.',
          items: {
            type: 'string',
            enum: ['email', 'team', 'user', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_member',
    description: 'Get detailed information about a specific member by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The member ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_member',
    description: 'Create a person that tickets can be assigned to',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Display name',
        },
        email: {
          type: 'string',
          description: 'Email address (optional)',
        },
        team: {
          type: 'string',
          description: 'Team ID this person belongs to (optional)',
        },
        user: {
          type: 'string',
          description: 'Login account ID to link this person to (optional). One account maps to at most one member.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_member',
    description: 'Update an existing member',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The member ID to update',
        },
        name: {
          type: 'string',
          description: 'New display name',
        },
        email: {
          type: 'string',
          description: 'New email address',
        },
        team: {
          type: 'string',
          description: 'New team ID (use null to remove from the team)',
        },
        active: {
          type: 'boolean',
          description: 'Set false when someone leaves. They keep existing assignments but drop out of the pickers.',
        },
        user: {
          type: 'string',
          description: 'Login account ID to link (use null to unlink)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_member',
    description: 'Delete a member (tickets assigned to this person become unassigned). Prefer setting active to false, which preserves history.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The member ID to delete',
        },
      },
      required: ['id'],
    },
  },

  {
    name: 'list_tickets',
    description: 'List tickets in Local PM with optional filters. By default returns only basic fields (id, title, status, project). Use "include" to request additional fields. Note: Relationship fields are returned in slim format - project returns {id, prefix}, team and assignee return {id, name}, blockedBy returns array of ticket IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Filter by project ID',
        },
        teamId: {
          type: 'string',
          description: 'Filter by team ID',
        },
        assigneeId: {
          type: 'string',
          description: 'Filter by assignee (member) ID',
        },
        epicId: {
          type: 'string',
          description: 'Only return tickets that roll up into this epic (a ticket ID)',
        },
        isEpic: {
          type: 'boolean',
          description: 'Set true to return only epics, false to return only non-epic tickets',
        },
        cycleId: {
          type: 'string',
          description: 'Filter by cycle ID. Use list_cycles to find one.',
        },
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['todo', 'in_progress', 'done'],
        },
        priority: {
          type: 'string',
          description: 'Filter by priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tickets to return (default: 20)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1). Use with limit to paginate through results.',
        },
        include: {
          type: 'array',
          description: 'Additional fields to include in the response. By default only id, title, status, and project are returned.',
          items: {
            type: 'string',
            enum: ['description', 'team', 'assignee', 'cycle', 'priority', 'startDate', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'epic', 'isEpic', 'sortOrder', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },
  {
    name: 'get_ticket',
    description: 'Get detailed information about a specific ticket by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_epic',
    description: 'Get an epic with every ticket that rolls up into it, plus rollup progress (done, in progress, cancelled and percent complete). Cancelled tickets are left out of the percentage.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID of the epic',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_ticket',
    description: 'Create a new ticket in Local PM',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Ticket title',
        },
        description: {
          type: 'string',
          description: 'Ticket description (supports HTML for rich text)',
        },
        project: {
          type: 'string',
          description: 'Project ID (required)',
        },
        team: {
          type: 'string',
          description: 'Team ID (optional)',
        },
        assignee: {
          type: 'string',
          description: 'Assignee member ID (optional). Use list_members to find one.',
        },
        cycle: {
          type: 'string',
          description: 'Cycle ID to commit this ticket to (optional). Use list_cycles to find one.',
        },
        estimate: {
          type: ['number', 'string'],
          description:
            'Effort estimate, as a point value or a t-shirt size (xs, s, m, l, xl). Only meaningful when the project has estimates enabled.',
        },
        status: {
          type: 'string',
          description: 'Ticket status',
          enum: ['todo', 'in_progress', 'done'],
          default: 'todo',
        },
        priority: {
          type: 'string',
          description: 'Ticket priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
          default: 'no_priority',
        },
        startDate: {
          type: 'string',
          description: 'Start date in ISO format (YYYY-MM-DD). Must not fall after dueDate.',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in ISO format (YYYY-MM-DD)',
        },
        labels: {
          type: 'array',
          description:
            'Shared labels, given as label names, keys or ids. Use list_labels to see what exists; a name that does not match an existing label creates one.',
          items: { type: 'string' },
        },
        subtasks: {
          type: 'array',
          description: 'Array of subtasks with title and completed status',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              completed: { type: 'boolean', default: false },
            },
            required: ['title'],
          },
        },
        blockedBy: {
          type: 'array',
          description: 'Array of ticket IDs that block this ticket. The ticket cannot be worked on until all blocking tickets are done.',
          items: {
            type: 'string',
          },
        },
        isEpic: {
          type: 'boolean',
          description: 'Create this ticket as an epic so other tickets in the same project can roll up into it. Epics cannot themselves belong to an epic.',
          default: false,
        },
        epic: {
          type: 'string',
          description: 'ID of the epic this ticket rolls up into. The epic must be marked isEpic and live in the same project.',
        },
      },
      required: ['title', 'project'],
    },
  },
  {
    name: 'update_ticket',
    description: 'Update an existing ticket',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID to update',
        },
        title: {
          type: 'string',
          description: 'New ticket title',
        },
        description: {
          type: 'string',
          description: 'New ticket description',
        },
        team: {
          type: 'string',
          description: 'New team ID (use null to unassign)',
        },
        assignee: {
          type: 'string',
          description: 'New assignee member ID (use null to unassign)',
        },
        cycle: {
          type: 'string',
          description: 'New cycle ID (use null to take the ticket out of its cycle)',
        },
        estimate: {
          type: ['number', 'string'],
          description:
            'New effort estimate, as a point value or a t-shirt size (xs, s, m, l, xl). Use null to clear it.',
        },
        status: {
          type: 'string',
          description: 'New ticket status',
          enum: ['todo', 'in_progress', 'done'],
        },
        priority: {
          type: 'string',
          description: 'New ticket priority',
          enum: ['no_priority', 'urgent', 'high', 'medium', 'low'],
        },
        startDate: {
          type: 'string',
          description: 'New start date in ISO format (use null to clear). Must not fall after dueDate.',
        },
        dueDate: {
          type: 'string',
          description: 'New due date in ISO format (use null to clear)',
        },
        labels: {
          type: 'array',
          description:
            'The complete new set of labels, given as label names, keys or ids. Replaces the existing set; pass [] to clear it. A name that does not match an existing label creates one.',
          items: { type: 'string' },
        },
        subtasks: {
          type: 'array',
          description: 'New array of subtasks (replaces existing)',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              completed: { type: 'boolean' },
            },
            required: ['title'],
          },
        },
        blockedBy: {
          type: 'array',
          description: 'Array of ticket IDs that block this ticket (replaces existing). Use empty array to clear.',
          items: {
            type: 'string',
          },
        },
        isEpic: {
          type: 'boolean',
          description: 'Turn this ticket into an epic, or back into a normal ticket. Turning it off fails while tickets still roll up into it.',
        },
        epic: {
          type: 'string',
          description: 'ID of the epic this ticket rolls up into (use null to take it out of its epic).',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'move_ticket',
    description: 'Move a ticket to a different status (column on the Kanban board)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID to move',
        },
        status: {
          type: 'string',
          description: 'New status',
          enum: ['todo', 'in_progress', 'done'],
        },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'delete_ticket',
    description: 'Delete a ticket',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ticket ID to delete',
        },
      },
      required: ['id'],
    },
  },

  {
    name: 'get_board',
    description: 'Get the full Kanban board with tickets grouped by status. Optionally filter by project or team. By default returns only basic ticket fields (id, title, status, project). Use "include" to request additional fields. Note: Relationship fields are returned in slim format - project returns {id, prefix}, team and assignee return {id, name}, blockedBy returns array of ticket IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Filter by project ID',
        },
        teamId: {
          type: 'string',
          description: 'Filter by team ID',
        },
        assigneeId: {
          type: 'string',
          description: 'Filter by assignee (member) ID',
        },
        include: {
          type: 'array',
          description: 'Additional ticket fields to include. By default only id, title, status, and project are returned.',
          items: {
            type: 'string',
            enum: ['description', 'team', 'assignee', 'cycle', 'priority', 'startDate', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'epic', 'isEpic', 'sortOrder', 'createdAt', 'updatedAt'],
          },
        },
      },
    },
  },

  {
    name: 'toggle_subtask',
    description: 'Toggle a subtask completion status',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID containing the subtask',
        },
        subtaskIndex: {
          type: 'number',
          description: 'The index of the subtask to toggle (0-based)',
        },
      },
      required: ['ticketId', 'subtaskIndex'],
    },
  },
  {
    name: 'add_subtask',
    description: 'Add a subtask to a ticket',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket ID to add subtask to',
        },
        title: {
          type: 'string',
          description: 'Subtask title',
        },
      },
      required: ['ticketId', 'title'],
    },
  },

  {
    name: 'list_labels',
    description:
      'List the shared labels in the workspace, with their group. Labels are workspace-wide, so the same label can be applied to tickets in any project.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Filter to labels whose name contains this text',
        },
        group: {
          type: 'string',
          description: 'Only return labels in this group, by group name, key or id',
        },
        limit: {
          type: 'number',
          description: 'Maximum labels to return (default 200)',
          default: 200,
        },
      },
    },
  },
  {
    name: 'list_activity',
    description: 'Read the change history of a ticket, oldest first. Entries cover field changes (action "changed", with the field and the values before and after as they read at the time) and the comment thread (actions "commented", "replied", "edited", "resolved", "reopened", "deleted", carrying the comment text). The text of a deleted comment is kept here after the comment itself is gone. The history is written automatically and cannot be edited or deleted. Board reordering is not recorded.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket whose history to read',
        },
        field: {
          type: 'string',
          description: 'Only return changes to this field, e.g. "status", "assignee", "priority", "title", "dueDate", "labels", "blockedBy", "subtasks", "project", "team", "description"',
        },
        action: {
          type: 'string',
          description: 'Only return entries with this action: "created", "changed", "commented", "replied", "edited", "resolved", "reopened" or "deleted"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default: 50)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1)',
        },
      },
      required: ['ticketId'],
    },
  },

  {
    name: 'list_comments',
    description: 'List the comments on a ticket, oldest first. Threads are one level deep: a comment with a "parent" is a reply to the comment that opened that thread. Mentions appear in the body as @[Name](member:ID) and are also resolved into the "mentions" array.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket whose comments to list',
        },
        parentId: {
          type: 'string',
          description: 'Only return the replies in this thread. Omit for every comment on the ticket.',
        },
        includeResolved: {
          type: 'boolean',
          description: 'Include threads that have been marked resolved (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of comments to return (default: 50)',
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-indexed, default: 1)',
        },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'add_comment',
    description: 'Post a comment on a ticket, or a reply in an existing thread. The body is markdown. To mention someone write @[Their Name](member:THEIR_ID); use list_members to find the ID. Replies go on the comment that opened the thread, never on another reply.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'The ticket to comment on',
        },
        body: {
          type: 'string',
          description: 'Markdown body. Mentions use @[Name](member:ID).',
        },
        parentId: {
          type: 'string',
          description: 'The comment that opened the thread, to post this as a reply (optional)',
        },
        authorId: {
          type: 'string',
          description: 'Member ID to attribute this comment to (optional). Without it the comment is attributed to the signed-in account, or to nobody.',
        },
      },
      required: ['ticketId', 'body'],
    },
  },
  {
    name: 'update_comment',
    description: 'Edit a comment body, or resolve/reopen a thread. Only the comment that opened a thread can be resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The comment ID',
        },
        body: {
          type: 'string',
          description: 'New markdown body',
        },
        resolved: {
          type: 'boolean',
          description: 'Mark the thread resolved (true) or reopen it (false)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_comment',
    description: 'Delete a comment. Deleting the comment that opened a thread deletes its replies too. This cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The comment ID to delete',
        },
      },
      required: ['id'],
    },
  },
];

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'list_projects': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];
      let query = `?limit=${limit}&page=${page}&depth=0`;
      if (args.status) {
        query += `&where[status][equals]=${toPayloadValue(args.status as string)}`;
      }
      query += await projectScopeParam('id');
      const response = await apiRequest(`/projects${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const defaultFields = ['id', 'name', 'prefix', 'status', 'color', 'icon'];
      const optionalFields = ['description', 'createdAt', 'updatedAt'];

      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      const filteredDocs = response.docs.map(project => {
        const filtered: Record<string, unknown> = {};
        for (const field of fieldsToInclude) {
          if (field in project) {
            filtered[field] = project[field];
          }
        }
        return filtered;
      });

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_project': {
      const project = (await apiRequest(`/projects/${args.id}?depth=1`)) as Record<string, unknown>;
      if (!(await mayOpenProject(projectIdOf(project.id)))) {
        throw new Error(`Project ${args.id} was not found in your visible projects.`);
      }
      return project;
    }
    case 'create_project': {
      return apiRequest('/projects', 'POST', {
        name: args.name,
        prefix: (args.prefix as string).toUpperCase(),
        description: args.description || null,
        status: toPayloadValue(args.status as string) || 'ACTIVE',
        icon: args.icon || 'folder',
        color: args.color || '#6366f1',
        startDate: args.startDate || null,
        targetDate: args.targetDate || null,
      });
    }
    case 'update_project': {
      const id = args.id;
      const updates: Record<string, unknown> = {};
      if (args.name) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.status) updates.status = toPayloadValue(args.status as string);
      if (args.icon) updates.icon = args.icon;
      if (args.color) updates.color = args.color;
      if (args.startDate !== undefined) updates.startDate = args.startDate;
      if (args.targetDate !== undefined) updates.targetDate = args.targetDate;
      if (args.estimates !== undefined) {
        const requested = args.estimates as { enabled?: boolean; scale?: string };
        const current = (await apiRequest(`/projects/${id}?depth=0`)) as {
          estimates?: { enabled?: boolean; scale?: string };
        };
        updates.estimates = {
          enabled: requested.enabled ?? current.estimates?.enabled ?? false,
          scale:
            (requested.scale ? requested.scale.toUpperCase() : undefined) ??
            current.estimates?.scale ??
            'FIBONACCI',
        };
      }
      return apiRequest(`/projects/${id}`, 'PATCH', updates);
    }
    case 'delete_project': {
      const { id, deleteTickets = true } = args;
      if (deleteTickets) {
        const ticketsResponse = await apiRequest(
          `/tickets?where[project][equals]=${id}&limit=1000`
        ) as { docs: Array<{ id: string }> };
        for (const ticket of ticketsResponse.docs || []) {
          await apiRequest(`/tickets/${ticket.id}`, 'DELETE');
        }
      }
      return apiRequest(`/projects/${id}`, 'DELETE');
    }

    case 'list_initiatives': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];
      let query = `?limit=${limit}&page=${page}&depth=1`;
      if (args.status) {
        query += `&where[status][equals]=${toPayloadValue(args.status as string)}`;
      }
      if (args.project) {
        query += `&where[projects][in]=${args.project}`;
      }

      const response = (await apiRequest(`/initiatives${query}`)) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const defaultFields = ['id', 'name', 'status', 'targetDate', 'color', 'icon'];
      const optionalFields = ['description', 'lead', 'projects', 'createdAt', 'updatedAt'];
      const fieldsToInclude = new Set([
        ...defaultFields,
        ...includeFields.filter((f) => optionalFields.includes(f)),
      ]);

      const docs = response.docs.map((initiative) => {
        const filtered: Record<string, unknown> = {};
        for (const field of fieldsToInclude) {
          if (field === 'projects') {
            filtered.projects = initiativeProjectIds(initiative);
          } else if (field === 'lead') {
            filtered.lead = slimMember(initiative.lead);
          } else if (field in initiative) {
            filtered[field] = initiative[field];
          }
        }
        filtered.projectCount = initiativeProjectIds(initiative).length;
        return filtered;
      });

      return formatPaginatedResponse({ ...response, docs });
    }
    case 'get_initiative': {
      const initiative = await loadInitiative(args.id as string);
      const projects = Array.isArray(initiative.projects)
        ? (initiative.projects.filter(
            (entry) => entry && typeof entry === 'object'
          ) as Array<Record<string, unknown>>)
        : [];

      const perProject = await rollupInitiativeProjects(projects);

      return {
        initiative: {
          id: initiative.id,
          name: initiative.name,
          status: initiative.status,
          targetDate: initiative.targetDate ?? null,
          lead: slimMember(initiative.lead),
          color: initiative.color ?? null,
          icon: initiative.icon ?? null,
        },
        progress: rollupInitiative(perProject),
        projects: perProject,
      };
    }
    case 'create_initiative': {
      return apiRequest('/initiatives', 'POST', {
        name: args.name,
        description: args.description || null,
        status: toPayloadValue(args.status as string) || 'PLANNED',
        projects: (args.projects as string[]) || [],
        lead: args.lead || null,
        targetDate: args.targetDate || null,
        icon: args.icon || 'target',
        color: args.color || '#6366f1',
      });
    }
    case 'update_initiative': {
      const updates: Record<string, unknown> = {};
      if (args.name) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.status) updates.status = toPayloadValue(args.status as string);
      if (args.projects !== undefined) updates.projects = args.projects;
      if (args.lead !== undefined) updates.lead = args.lead || null;
      if (args.targetDate !== undefined) updates.targetDate = args.targetDate || null;
      if (args.icon) updates.icon = args.icon;
      if (args.color) updates.color = args.color;
      return apiRequest(`/initiatives/${args.id}`, 'PATCH', updates);
    }
    case 'delete_initiative': {
      return apiRequest(`/initiatives/${args.id}`, 'DELETE');
    }
    case 'add_project_to_initiative': {
      const initiative = await loadInitiative(args.id as string);
      const current = initiativeProjectIds(initiative);
      const project = args.project as string;

      if (current.includes(project)) {
        throw new Error(
          `Project ${project} is already in initiative "${initiative.name}".`
        );
      }

      return setInitiativeProjects(args.id as string, [...current, project]);
    }
    case 'remove_project_from_initiative': {
      const initiative = await loadInitiative(args.id as string);
      const current = initiativeProjectIds(initiative);
      const project = args.project as string;

      if (!current.includes(project)) {
        throw new Error(`Project ${project} is not in initiative "${initiative.name}".`);
      }

      return setInitiativeProjects(
        args.id as string,
        current.filter((id) => id !== project)
      );
    }

    case 'list_teams': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];
      const query = `?limit=${limit}&page=${page}&depth=0`;
      const response = await apiRequest(`/teams${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const defaultFields = ['id', 'name', 'color'];
      const optionalFields = ['description', 'createdAt', 'updatedAt'];

      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      const filteredDocs = response.docs.map(team => {
        const filtered: Record<string, unknown> = {};
        for (const field of fieldsToInclude) {
          if (field in team) {
            filtered[field] = team[field];
          }
        }
        return filtered;
      });

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_team': {
      return apiRequest(`/teams/${args.id}?depth=1`);
    }
    case 'create_team': {
      return apiRequest('/teams', 'POST', {
        name: args.name,
        description: args.description || null,
        color: args.color || '#6366f1',
      });
    }
    case 'update_team': {
      const { id, ...updates } = args;
      return apiRequest(`/teams/${id}`, 'PATCH', updates);
    }
    case 'delete_team': {
      return apiRequest(`/teams/${args.id}`, 'DELETE');
    }

    case 'list_cycles': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];

      let query = `?limit=${limit}&page=${page}&depth=0&sort=-number`;
      if (args.projectId) {
        query += `&where[project][equals]=${args.projectId}`;
      }

      const response = await apiRequest(`/cycles${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const defaultFields = ['id', 'name', 'number', 'startsAt', 'endsAt', 'completedAt'];
      const optionalFields = ['goal', 'rolledOver', 'project', 'createdAt', 'updatedAt'];
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      const wanted = args.state as string | undefined;
      const filteredDocs = response.docs
        .map(cycle => {
          const filtered: Record<string, unknown> = {};
          for (const field of fieldsToInclude) {
            if (field in cycle) {
              filtered[field] = cycle[field];
            }
          }
          filtered.state = cycleStateOf(cycle);
          return filtered;
        })
        .filter(cycle => !wanted || cycle.state === wanted);

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_cycle': {
      const cycle = await apiRequest(`/cycles/${args.id}?depth=1`) as Record<string, unknown>;
      const tickets = await apiRequest(
        `/tickets?where[cycle][equals]=${args.id}&limit=1000&depth=1`,
      ) as { docs: Array<Record<string, unknown>>; totalDocs: number };

      const done = tickets.docs.filter(ticket => {
        const status = ticket.status as { type?: string } | null;
        return status?.type === 'COMPLETED';
      }).length;

      return {
        ...cycle,
        state: cycleStateOf(cycle),
        ticketCount: tickets.totalDocs,
        ticketsDone: done,
      };
    }
    case 'create_cycle': {
      return apiRequest('/cycles', 'POST', {
        project: args.project,
        number: args.number,
        name: args.name || `Cycle ${args.number}`,
        startsAt: toCycleDate(args.startsAt as string),
        endsAt: toCycleDate(args.endsAt as string),
        goal: args.goal || null,
      });
    }
    case 'update_cycle': {
      const { id, startsAt, endsAt, ...rest } = args;
      const updates: Record<string, unknown> = { ...rest };
      if (startsAt) updates.startsAt = toCycleDate(startsAt as string);
      if (endsAt) updates.endsAt = toCycleDate(endsAt as string);
      return apiRequest(`/cycles/${id}`, 'PATCH', updates);
    }
    case 'delete_cycle': {
      return apiRequest(`/cycles/${args.id}`, 'DELETE');
    }
    case 'close_cycle': {
      return apiRequest(`/cycles/${args.id}/close`, 'POST');
    }
    case 'get_cycle_burndown': {
      return apiRequest(`/cycles/${args.id}/burndown${args.live ? '?live=true' : ''}`);
    }
    case 'get_velocity': {
      const window = args.window ? `&window=${args.window}` : '';
      return apiRequest(`/cycles/velocity?project=${args.projectId}${window}`);
    }
    case 'reconcile_cycles': {
      return apiRequest('/cycles/reconcile', 'POST', args.projectId ? { project: args.projectId } : {});
    }

    case 'list_members': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];
      const activeOnly = args.activeOnly === undefined ? true : Boolean(args.activeOnly);

      let query = `?limit=${limit}&page=${page}&depth=1&sort=name`;
      if (args.teamId) {
        query += `&where[team][equals]=${args.teamId}`;
      }
      if (activeOnly) {
        query += '&where[active][equals]=true';
      }

      const response = await apiRequest(`/members${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const defaultFields = ['id', 'name', 'active'];
      const optionalFields = ['email', 'team', 'user', 'createdAt', 'updatedAt'];
      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      const filteredDocs = response.docs.map(member => {
        const filtered: Record<string, unknown> = {};
        for (const field of fieldsToInclude) {
          if (!(field in member)) continue;
          filtered[field] = field === 'team' ? slimTeam(member[field]) : member[field];
        }
        return filtered;
      });

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_member': {
      return apiRequest(`/members/${args.id}?depth=1`);
    }
    case 'create_member': {
      return apiRequest('/members', 'POST', {
        name: args.name,
        email: args.email || null,
        team: args.team || null,
        user: args.user || null,
      });
    }
    case 'update_member': {
      const id = args.id;
      const updates: Record<string, unknown> = {};
      if (args.name) updates.name = args.name;
      if (args.email !== undefined) updates.email = args.email;
      if (args.team !== undefined) updates.team = args.team;
      if (args.active !== undefined) updates.active = args.active;
      if (args.user !== undefined) updates.user = args.user;
      return apiRequest(`/members/${id}`, 'PATCH', updates);
    }
    case 'delete_member': {
      return apiRequest(`/members/${args.id}`, 'DELETE');
    }

    case 'list_tickets': {
      const limit = (args.limit as number) || 20;
      const page = (args.page as number) || 1;
      const includeFields = (args.include as string[]) || [];

      let query = `?limit=${limit}&page=${page}&depth=1`;
      if (args.projectId) {
        query += `&where[project][equals]=${args.projectId}`;
      }
      if (args.teamId) {
        query += `&where[team][equals]=${args.teamId}`;
      }
      if (args.assigneeId) {
        query += `&where[assignee][equals]=${args.assigneeId}`;
      }
      if (args.epicId) {
        query += `&where[epic][equals]=${args.epicId}`;
      }
      if (args.isEpic !== undefined) {
        query += `&where[isEpic][equals]=${args.isEpic ? 'true' : 'false'}`;
      }
      if (args.cycleId) {
        query += `&where[cycle][equals]=${args.cycleId}`;
      }
      if (args.status) {
        query += `&where[status][equals]=${await resolveStatusId(args.status as string, args.projectId as string | undefined)}`;
      }
      if (args.priority) {
        query += `&where[priority][equals]=${toPayloadValue(args.priority as string)}`;
      }
      query += await projectScopeParam('project');
      const response = await apiRequest(`/tickets${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const defaultFields = ['id', 'title', 'status', 'project'];
      const optionalFields = ['description', 'team', 'assignee', 'cycle', 'priority', 'startDate', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'epic', 'isEpic', 'sortOrder', 'createdAt', 'updatedAt'];

      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      const filteredDocs = response.docs.map(ticket => slimTicket(ticket, fieldsToInclude));

      return formatPaginatedResponse({
        ...response,
        docs: filteredDocs,
      });
    }
    case 'get_ticket': {
      const ticket = (await apiRequest(`/tickets/${args.id}?depth=1`)) as Record<string, unknown>;
      if (!(await mayOpenProject(projectIdOf(ticket.project)))) {
        throw new Error(`Ticket ${args.id} was not found in your visible projects.`);
      }
      return ticket;
    }
    case 'get_epic': {
      const epic = (await apiRequest(`/tickets/${args.id}?depth=1`)) as Record<string, unknown>;
      if (!epic.isEpic) {
        throw new Error(
          `Ticket ${epic.ticketId ?? args.id} is not an epic. Set isEpic on it first with update_ticket.`,
        );
      }

      const response = (await apiRequest(
        `/tickets?where[epic][equals]=${args.id}&limit=200&depth=1&sort=sortOrder`,
      )) as { docs: Array<Record<string, unknown>> };

      const fields = new Set(['id', 'ticketId', 'title', 'status', 'assignee', 'priority']);
      const children = response.docs.map(child => slimTicket(child, fields));

      return {
        epic: {
          id: epic.id,
          ticketId: epic.ticketId ?? null,
          title: epic.title,
          status: epic.status,
          project: slimProject(epic.project),
        },
        progress: rollupEpic(response.docs),
        children,
      };
    }
    case 'create_ticket': {
      return apiRequest('/tickets', 'POST', {
        title: args.title,
        description: args.description || null,
        project: args.project,
        team: args.team || null,
        assignee: args.assignee || null,
        cycle: args.cycle || null,
        estimate: resolveEstimate(args.estimate),
        status:
          (await resolveStatusId(args.status as string, args.projectId as string | undefined)) ||
          (await defaultStatusId(args.projectId as string | undefined)),
        priority: toPayloadValue(args.priority as string) || 'NO_PRIORITY',
        startDate: args.startDate || null,
        dueDate: args.dueDate || null,
        labels: (await resolveLabelIds(args.labels)) ?? [],
        subtasks: args.subtasks || [],
        blockedBy: args.blockedBy || [],
        isEpic: args.isEpic === true,
        epic: args.epic || null,
      });
    }
    case 'update_ticket': {
      const id = args.id;
      const updates: Record<string, unknown> = {};
      if (args.title) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.team !== undefined) updates.team = args.team;
      if (args.assignee !== undefined) updates.assignee = args.assignee;
      if (args.cycle !== undefined) updates.cycle = args.cycle;
      if (args.estimate !== undefined) updates.estimate = resolveEstimate(args.estimate);
      if (args.status) updates.status = await resolveStatusId(args.status as string);
      if (args.priority) updates.priority = toPayloadValue(args.priority as string);
      if (args.startDate !== undefined) updates.startDate = args.startDate;
      if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
      if (args.labels !== undefined) updates.labels = await resolveLabelIds(args.labels);
      if (args.subtasks) updates.subtasks = args.subtasks;
      if (args.blockedBy !== undefined) updates.blockedBy = args.blockedBy;
      if (args.isEpic !== undefined) updates.isEpic = args.isEpic;
      if (args.epic !== undefined) updates.epic = args.epic;
      return apiRequest(`/tickets/${id}`, 'PATCH', updates);
    }
    case 'move_ticket': {
      return apiRequest(`/tickets/${args.id}`, 'PATCH', {
        status: await resolveStatusId(args.status as string),
      });
    }
    case 'delete_ticket': {
      return apiRequest(`/tickets/${args.id}`, 'DELETE');
    }

    case 'get_board': {
      const includeFields = (args.include as string[]) || [];

      let query = '?limit=1000&depth=1';
      if (args.projectId) {
        query += `&where[project][equals]=${args.projectId}`;
      }
      if (args.teamId) {
        query += `&where[team][equals]=${args.teamId}`;
      }
      if (args.assigneeId) {
        query += `&where[assignee][equals]=${args.assigneeId}`;
      }
      query += await projectScopeParam('project');
      const response = await apiRequest(`/tickets${query}`) as { docs: Array<Record<string, unknown>> };
      const tickets = response.docs || [];

      const defaultFields = ['id', 'title', 'status', 'project'];
      const optionalFields = ['description', 'team', 'assignee', 'cycle', 'priority', 'startDate', 'dueDate', 'labels', 'subtasks', 'blockedBy', 'epic', 'isEpic', 'sortOrder', 'createdAt', 'updatedAt'];

      const fieldsToInclude = new Set([...defaultFields, ...includeFields.filter(f => optionalFields.includes(f))]);

      const workflow = statusesForProject(await loadStatuses(), args.projectId as string | undefined);
      const keyOf = (ticket: Record<string, unknown>): string | null => {
        const status = ticket.status;
        if (!status) return null;
        if (typeof status === 'string') {
          return workflow.find((doc) => doc.id === status)?.key ?? null;
        }
        return (status as StatusDoc).key ?? null;
      };

      const columns = workflow.map((doc) => ({
        key: doc.key,
        name: doc.name,
        type: doc.type,
        tickets: tickets.filter((t) => keyOf(t) === doc.key).map((t) => slimTicket(t, fieldsToInclude)),
      }));

      return {
        columns,
        summary: {
          total: tickets.length,
          byStatus: columns.reduce<Record<string, number>>((acc, column) => {
            acc[column.key] = column.tickets.length;
            return acc;
          }, {}),
        },
      };
    }

    case 'toggle_subtask': {
      const ticket = await apiRequest(`/tickets/${args.ticketId}`) as {
        subtasks?: Array<{ title: string; completed: boolean }>
      };
      const subtasks = ticket.subtasks || [];
      const index = args.subtaskIndex as number;

      if (index < 0 || index >= subtasks.length) {
        throw new Error(`Subtask index ${index} out of range`);
      }

      subtasks[index].completed = !subtasks[index].completed;
      return apiRequest(`/tickets/${args.ticketId}`, 'PATCH', { subtasks });
    }
    case 'add_subtask': {
      const ticket = await apiRequest(`/tickets/${args.ticketId}`) as {
        subtasks?: Array<{ title: string; completed: boolean }>
      };
      const subtasks = ticket.subtasks || [];
      subtasks.push({ title: args.title as string, completed: false });
      return apiRequest(`/tickets/${args.ticketId}`, 'PATCH', { subtasks });
    }

    case 'list_labels': {
      const docs = await loadLabels(true);
      const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
      const group = typeof args.group === 'string' ? args.group.trim().toLowerCase() : '';
      const limit = typeof args.limit === 'number' ? args.limit : 200;

      const matches = docs.filter((doc) => {
        if (search && !doc.name.toLowerCase().includes(search)) return false;
        if (!group) return true;

        const own = doc.group;
        if (!own) return false;
        if (typeof own === 'string') return own === args.group;
        return (
          own.id === args.group ||
          (own.name ?? '').trim().toLowerCase() === group ||
          labelKey(own.name ?? '') === labelKey(group)
        );
      });

      return {
        labels: matches.slice(0, limit).map((doc) => ({
          id: doc.id,
          name: doc.name,
          key: doc.key,
          color: doc.color ?? null,
          group: typeof doc.group === 'object' && doc.group ? (doc.group.name ?? null) : null,
        })),
        total: matches.length,
      };
    }
    case 'list_activity': {
      const limit = (args.limit as number) || 50;
      const page = (args.page as number) || 1;

      if (!(await mayOpenTicketThroughProject(args.ticketId as string))) {
        throw new Error(`Ticket ${args.ticketId} was not found in your visible projects.`);
      }

      let query = `?limit=${limit}&page=${page}&depth=1&sort=createdAt`;
      query += `&where[ticket][equals]=${args.ticketId}`;
      if (args.field) {
        query += `&where[field][equals]=${args.field}`;
      }
      if (args.action) {
        query += `&where[action][equals]=${args.action}`;
      }

      const response = await apiRequest(`/activity${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const slimmed = response.docs.map(entry => ({
        id: entry.id,
        action: entry.action,
        field: entry.field ?? null,
        comment: slimComment(entry.comment),
        from: entry.from ?? null,
        to: entry.to ?? null,
        actor: slimMember(entry.actor),
        at: entry.createdAt,
      }));

      return formatPaginatedResponse({
        ...response,
        docs: slimmed,
      });
    }

    case 'list_comments': {
      const limit = (args.limit as number) || 50;
      const page = (args.page as number) || 1;

      if (!(await mayOpenTicketThroughProject(args.ticketId as string))) {
        throw new Error(`Ticket ${args.ticketId} was not found in your visible projects.`);
      }

      let query = `?limit=${limit}&page=${page}&depth=1&sort=createdAt`;
      query += `&where[ticket][equals]=${args.ticketId}`;
      if (args.parentId) {
        query += `&where[parent][equals]=${args.parentId}`;
      }
      if (args.includeResolved === false) {
        query += '&where[resolved][not_equals]=true';
      }

      const response = await apiRequest(`/comments${query}`) as {
        docs: Array<Record<string, unknown>>;
        totalDocs: number;
        limit: number;
        totalPages: number;
        page: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        nextPage?: number | null;
        prevPage?: number | null;
      };

      const slimmed = response.docs.map(comment => ({
        id: comment.id,
        parent: slimComment(comment.parent),
        body: comment.body,
        author: slimMember(comment.author),
        mentions: Array.isArray(comment.mentions)
          ? comment.mentions.map(m => slimMember(m)).filter(Boolean)
          : [],
        resolved: Boolean(comment.resolved),
        createdAt: comment.createdAt,
        editedAt: comment.editedAt ?? null,
      }));

      return formatPaginatedResponse({
        ...response,
        docs: slimmed,
      });
    }
    case 'add_comment': {
      if (!(await mayOpenTicketThroughProject(args.ticketId as string))) {
        throw new Error(`Ticket ${args.ticketId} was not found in your visible projects.`);
      }
      return apiRequest('/comments', 'POST', {
        ticket: args.ticketId,
        body: args.body,
        parent: args.parentId || null,
        author: args.authorId || undefined,
      });
    }
    case 'update_comment': {
      const updates: Record<string, unknown> = {};
      if (args.body !== undefined) updates.body = args.body;
      if (args.resolved !== undefined) updates.resolved = args.resolved;
      return apiRequest(`/comments/${args.id}`, 'PATCH', updates);
    }
    case 'delete_comment': {
      return apiRequest(`/comments/${args.id}`, 'DELETE');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  {
    name: 'local-pm-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleToolCall(name, args as Record<string, unknown>);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Local PM MCP Server running on stdio');
}

main().catch(console.error);
