#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { tools } from './tools.js';
import {
  matchStatus,
  projectIdOf,
  statusesForProject,
  unknownStatusMessage,
  type StatusDoc,
} from './statuses.js';

const BASE_URL = process.env.LOCAL_PM_URL || 'http://localhost:3010';

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

let statusCache: { at: number; docs: StatusDoc[] } | null = null;

async function loadStatuses(refresh = false): Promise<StatusDoc[]> {
  if (!refresh && statusCache && Date.now() - statusCache.at < 30000) return statusCache.docs;
  const response = (await apiRequest('/statuses?limit=200&depth=0')) as { docs?: StatusDoc[] };
  const docs = response.docs ?? [];
  statusCache = { at: Date.now(), docs };
  return docs;
}

async function resolveStatusId(value: string | undefined, projectId?: string): Promise<string | undefined> {
  if (!value) return undefined;
  const docs = await loadStatuses();
  const scope = statusesForProject(docs, projectId);
  const match = matchStatus(docs, scope, value);
  if (!match) throw new Error(unknownStatusMessage(value, scope));
  return match.id;
}

async function projectOfTicket(ticketId: string): Promise<string | undefined> {
  const ticket = (await apiRequest(`/tickets/${ticketId}?depth=0`)) as {
    project?: { id: string } | string | null;
  };
  return projectIdOf(ticket.project);
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
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
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
      return apiRequest(`/projects/${args.id}?depth=1`);
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
      return apiRequest(`/tickets/${args.id}?depth=1`);
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
          (await resolveStatusId(args.status as string, args.project as string | undefined)) ||
          (await defaultStatusId(args.project as string | undefined)),
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
      if (args.status) {
        updates.status = await resolveStatusId(args.status as string, await projectOfTicket(id as string));
      }
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
        status: await resolveStatusId(
          args.status as string,
          await projectOfTicket(args.id as string),
        ),
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

    case 'list_statuses': {
      const projectId = typeof args.projectId === 'string' ? args.projectId : undefined;
      const scope = statusesForProject(await loadStatuses(true), projectId);

      return {
        statuses: scope.map((doc) => ({
          id: doc.id,
          key: doc.key,
          name: doc.name,
          type: doc.type,
          order: doc.order ?? null,
          scope: doc.project ? 'project' : 'workspace',
        })),
        total: scope.length,
        default: scope[0]?.key ?? null,
      };
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
