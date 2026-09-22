import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
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
          description:
            'Filter by status. Statuses are configurable per workspace and per project. Accepts a status key, its display name, or its id — call list_statuses to see what this workspace offers.',
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
          description:
            'Ticket status. Statuses are configurable per workspace and per project. Accepts a status key, its display name, or its id — call list_statuses to see what this workspace offers. Defaults to the first status in the project workflow.',
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
          description:
            'New ticket status. Statuses are configurable per workspace and per project. Accepts a status key, its display name, or its id — call list_statuses to see what this workspace offers.',
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
          description:
            'New status. Statuses are configurable per workspace and per project. Accepts a status key, its display name, or its id — call list_statuses to see what this workspace offers.',
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
    name: 'list_statuses',
    description:
      'List the workflow statuses a ticket can occupy, in board column order. A status is workspace-wide unless it is scoped to one project, so pass projectId to see the workflow that project actually uses. Every tool that takes a status accepts the key, the name or the id returned here.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Return the workflow for this project: its workspace-wide statuses plus any scoped to it. Omit for the workspace-wide statuses only.',
        },
      },
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
