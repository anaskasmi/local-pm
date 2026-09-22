# Local PM

A lightweight, self-hosted project management tool with a built-in MCP (Model Context Protocol) server that enables AI assistants to manage your projects, tickets, and teams directly.

## Features

- **Kanban Board** - Drag-and-drop ticket management with Todo, In Progress, and Done columns
- **Projects** - Organize work with customizable projects (icons, colors, prefixes)
- **Teams** - Assign tickets to teams for better organization
- **Tickets** - Full-featured tickets with:
  - Priority levels (Urgent, High, Medium, Low)
  - Due dates
  - Shared labels, optionally grouped, reusable across every project
  - Subtasks with completion tracking
  - Ticket dependencies (blocked by)
  - Rich text descriptions
- **Comments** - Threaded discussion on every ticket, with markdown, `@` mentions and resolvable threads
- **Activity trail** - Every field change and comment event recorded with who did it, shown beside the comments
- **Attachments** - Drop, paste or pick files into a comment; images render inline, everything else becomes a link
- **MCP Server** - AI-native project management via Model Context Protocol
- **Self-Hosted** - Your data stays on your machine
- **A guided start** - A first-project welcome screen and an always-available getting-started guide
- **Find work quickly** - Search titles or ticket keys from the board, ticket lists, or command palette
- **Saved board views** - Name a set of filters and return to it later on the same browser
- **Recoverable ticket drafts** - Restore unfinished new tickets while the browser tab remains open
- **Responsive navigation** - Visible mobile navigation, keyboard-accessible drawers, and touch-sized controls
- **Docker Ready** - One command deployment

## Screenshots

### Kanban Board
<p>
  <img width="400" alt="Kanban Board" src="https://github.com/user-attachments/assets/d8f271ca-2503-41ea-9d7c-11aef09a9119" />
  <img width="400" alt="Ticket Details" src="https://github.com/user-attachments/assets/de2b062a-ec17-43b1-8bbb-31b208100cbc" />
</p>

### Tickets
<p>
  <img width="400" alt="Ticket View" src="https://github.com/user-attachments/assets/b2265f8f-8358-42d2-9b81-df8798bf4be2" />
  <img width="400" alt="Ticket Edit" src="https://github.com/user-attachments/assets/e04a0c77-6d74-477b-9ca1-a055ea9b0d47" />
</p>

### Projects
<p>
  <img width="400" alt="Projects List" src="https://github.com/user-attachments/assets/38bd0867-ed7e-43aa-bec2-c2ae469be01e" />
  <img width="400" alt="Project Details" src="https://github.com/user-attachments/assets/2970d1ea-eeba-49a5-91de-5a9a538a6857" />
</p>

### Teams
<p>
  <img width="400" alt="Teams List" src="https://github.com/user-attachments/assets/3db9dcd7-d7f9-4117-a82c-308eaff1ced3" />
  <img width="400" alt="Team Details" src="https://github.com/user-attachments/assets/20102c8e-c6e2-4bcb-bfcb-e1449914e275" />
</p>

## Installation

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/your-username/local-pm.git
cd local-pm
```

2. Start the containers:
```bash
docker-compose up -d
```

3. Access the app at http://localhost:3010

### Manual Installation

1. Clone the repository and install dependencies:
```bash
git clone https://github.com/your-username/local-pm.git
cd local-pm
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your MongoDB connection string
```

3. Run the development server:
```bash
npm run dev
```

## MCP Server Setup

The MCP (Model Context Protocol) server allows AI assistants like Claude to interact with your project management data directly.

### Building the MCP Server

```bash
cd mcp-server
npm install
npm run build
```

### Adding to Claude Code (Global)

```bash
claude mcp add --scope user local-pm node "/path/to/local-pm/mcp-server/dist/index.js"
```

### Adding to Claude Desktop

Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "local-pm": {
      "command": "node",
      "args": ["/path/to/local-pm/mcp-server/dist/index.js"],
      "env": {
        "LOCAL_PM_URL": "http://localhost:3010"
      }
    }
  }
}
```

## MCP Tools Reference

The MCP server exposes 31 tools for complete project management:

### Project Tools
| Tool | Description |
|------|-------------|
| `list_projects` | List all projects with optional status filter |
| `get_project` | Get detailed project information by ID |
| `create_project` | Create a new project with name, prefix, icon, color |
| `update_project` | Update project properties |
| `delete_project` | Delete a project and optionally all its tickets |

### Team Tools
| Tool | Description |
|------|-------------|
| `list_teams` | List all teams |
| `get_team` | Get detailed team information by ID |
| `create_team` | Create a new team |
| `update_team` | Update team properties |
| `delete_team` | Delete a team |

### Ticket Tools
| Tool | Description |
|------|-------------|
| `list_tickets` | List tickets with filters (project, team, status, priority) |
| `get_ticket` | Get detailed ticket information by ID |
| `create_ticket` | Create a new ticket with full properties |
| `update_ticket` | Update ticket properties |
| `move_ticket` | Move ticket to different status column |
| `delete_ticket` | Delete a ticket |

### Board & Subtask Tools
| Tool | Description |
|------|-------------|
| `get_board` | Get full Kanban board grouped by status |
| `toggle_subtask` | Toggle subtask completion status |
| `add_subtask` | Add a subtask to a ticket |

### Comment Tools
| Tool | Description |
|------|-------------|
| `list_comments` | List a ticket's comments, oldest first |
| `add_comment` | Post a comment, or a reply in an existing thread |
| `update_comment` | Edit a comment, or resolve/reopen a thread |
| `delete_comment` | Delete a comment and any replies under it |

### Status Tools
| Tool | Description |
|------|-------------|
| `list_statuses` | List the workflow statuses a ticket can occupy, in board column order |

### Label Tools
| Tool | Description |
|------|-------------|
| `list_labels` | List the workspace's shared labels, with their group |

### Activity Tools
| Tool | Description |
|------|-------------|
| `list_activity` | Read a ticket's change history, including the comment thread |

## How MCP Enhances AI Development

### What is MCP?

Model Context Protocol (MCP) is an open standard that enables AI assistants to interact with external tools and data sources. Instead of just chatting, AI can take actions in the real world through well-defined tool interfaces.

### Benefits for AI-Assisted Development

1. **Persistent Task Tracking**
   - AI can create tickets for features it's implementing
   - Track progress across coding sessions
   - Never lose context on what was done or what's pending

2. **Structured Workflow**
   - AI breaks down complex features into subtasks
   - Sets priorities and due dates
   - Manages dependencies between tickets

3. **Project Organization**
   - AI can organize work into logical projects
   - Assign tasks to teams
   - Maintain a clear overview of all work

4. **Seamless Integration**
   - Works directly in your AI coding workflow
   - No context switching to external tools
   - AI reads and updates tickets as it works

### Example Workflow

```
You: "Create a project for our new authentication system"

AI: [Creates project AUTH with relevant description]

You: "Break down the login feature into tickets"

AI: [Creates tickets for:
  - AUTH-1: Implement login form UI
  - AUTH-2: Create authentication API endpoint
  - AUTH-3: Add JWT token handling
  - AUTH-4: Implement session management
  Sets AUTH-2 as blocking AUTH-3 and AUTH-4]

You: "Start working on the login form"

AI: [Moves AUTH-1 to In Progress, implements the feature,
     then moves to Done when complete]
```

### Why Local & Self-Hosted?

- **Privacy**: Your project data stays on your machine
- **Speed**: No network latency for AI tool calls
- **Control**: Customize and extend as needed
- **Offline**: Works without internet connection

## Security

Local PM is **local-first**. Out of the box it is open, which is the right
default for a tool bound to loopback on your own machine and the wrong one for
anything another host can reach.

### Access control

By default the REST and GraphQL APIs are fully open: any client that can reach
the port can read and write every ticket, project and team. To require a
logged-in user for every operation, set:

```bash
LOCAL_PM_REQUIRE_AUTH=true
```

Bootstrap the first account over REST:

```bash
curl -X POST http://localhost:3010/api/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-strong-password","role":"admin"}'
```

Then authenticate as either a person or an automated caller:

```bash
# Person — log in, then send the returned token
curl -X POST http://localhost:3010/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-strong-password"}'

curl -H "Authorization: JWT <token>" http://localhost:3010/api/tickets

# Automation — issue an API key per caller in the users collection
curl -H "Authorization: users API-Key <key>" http://localhost:3010/api/tickets
```

Roles: `admin` (may delete and manage accounts), `member` (read/write), and
`agent` (automated callers, which should hold an API key rather than a
password).

> Turn the flag on **only once every caller holds a credential** — the bundled
> MCP server included — or you will lock out your own automation.

### Network exposure

`docker compose` publishes the app on `127.0.0.1` and gives MongoDB no host
port at all. To expose the app deliberately, set `LOCAL_PM_BIND=0.0.0.0` — and
enable `LOCAL_PM_REQUIRE_AUTH` before you do.

Secrets (`PAYLOAD_SECRET`, `DATABASE_URI`) are passed at runtime only, never as
Docker build args, since build args are baked into image layers and readable
through `docker history`.

### Known issue

The Payload admin panel at `/admin` currently returns 500 (`Cannot destructure
property 'config'` from `@payloadcms/ui`). This is pre-existing and unrelated to
access control — create the first account over REST as shown above. Everything
else, including the whole REST API, is unaffected.

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest — pure logic (drag math, access rules)
npm run test:e2e    # playwright — full browser E2E
npm run verify      # all three
```

E2E tests run against their **own database** (`local-pm-e2e-<port>`, derived from
`DATABASE_URI`), never your working one. Everything a run touches is keyed to its
port — database, build directory (`.next-e2e-<port>`) and artifacts
(`test-results-<port>`) — and the port is claimed by scanning upward from 3020 for
a free one. Concurrent runs therefore isolate themselves with no setup, and the
suite never attaches to an already-running server.

Each run starts from an empty database: `global-setup` clears every collection
before the migrations seed it, so test data cannot accumulate between runs.

| Variable | Default | Use |
|---|---|---|
| `E2E_PORT` | first free from 3020 | Pin the port, and with it the database, build dir and artifacts |
| `E2E_PORT_BASE` | `3020` | Where the scan starts |
| `E2E_PORT_SCAN_LIMIT` | `20` | How many ports the scan tries |
| `E2E_DATABASE_URI` | derived from `DATABASE_URI` | Point the suite at a specific database |
| `E2E_KEEP_DATABASE` | unset | Set to `true` to keep the previous run's data |

First run needs browsers:

```bash
npx playwright install chromium
```

## Upgrading an existing install

Two data-model changes need a one-off migration. Both are idempotent, so running
them twice is safe, and both run automatically against the E2E database.

```bash
npm run migrate:statuses   # string ticket statuses -> the statuses collection
npm run migrate:labels     # inline ticket labels   -> the labels collection
```

`migrate:labels` creates one shared label per distinct inline label name, keeping
the closest colour from the fixed palette, and rewrites each ticket to reference
them. Labels that differed only in casing or punctuation collapse into one — that
is the point of the change.

## Tech Stack

- **Frontend**: Next.js 15, React, Tailwind CSS
- **Backend**: Payload CMS 3.0
- **Database**: MongoDB
- **MCP Server**: TypeScript, @modelcontextprotocol/sdk
- **Testing**: Vitest (unit), Playwright (E2E)

## Special Thanks

Built with [Payload CMS](https://payloadcms.com/)
