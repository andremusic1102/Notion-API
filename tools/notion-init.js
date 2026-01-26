#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECTS_DB_ID = process.env.NOTION_PROJECTS_DB_ID;
const TICKETS_DB_ID = process.env.NOTION_TICKETS_DB_ID;
const NOTION_VERSION = '2022-06-28';
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_TOKEN = process.env.NOTION_TOKEN;

function ensureNotionConfig() {
  if (!NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN must be set');
  }
  if (!PROJECTS_DB_ID) {
    throw new Error('NOTION_PROJECTS_DB_ID must be set');
  }
  if (!TICKETS_DB_ID) {
    throw new Error('NOTION_TICKETS_DB_ID must be set');
  }
}

function resolveSpecPath(specArg) {
  if (!specArg) {
    throw new Error('Missing --spec argument');
  }
  return path.isAbsolute(specArg) ? specArg : path.resolve(process.cwd(), specArg);
}

function splitKeyValue(line) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }
  const key = line.slice(0, colonIndex).trim();
  const value = line.slice(colonIndex + 1).trim();
  return { key, value };
}

function parseSpec(specPath) {
  const raw = fs.readFileSync(specPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let section = null;
  const projectLines = [];
  const ticketLines = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('Project:')) {
      section = 'project';
      continue;
    }
    if (trimmed.startsWith('Tickets:')) {
      section = 'tickets';
      continue;
    }
    if (section === 'project') {
      projectLines.push(trimmed.replace(/^-+\s*/, ''));
    } else if (section === 'tickets') {
      ticketLines.push(trimmed.replace(/^-+\s*/, ''));
    }
  }

  const project = {};
  for (const line of projectLines) {
    const parsed = splitKeyValue(line);
    if (parsed) {
      project[parsed.key] = parsed.value;
    }
  }

  const tickets = [];
  let currentTicket = null;
  for (const line of ticketLines) {
    if (line.startsWith('Title:')) {
      if (currentTicket) {
        tickets.push(currentTicket);
      }
      currentTicket = {};
      const parsed = splitKeyValue(line);
      if (parsed) {
        currentTicket[parsed.key] = parsed.value;
      }
      continue;
    }
    if (!currentTicket) {
      continue;
    }
    const parsed = splitKeyValue(line);
    if (parsed) {
      currentTicket[parsed.key] = parsed.value;
    }
  }
  if (currentTicket) {
    tickets.push(currentTicket);
  }

  return { project, tickets };
}

function buildTitle(value) {
  if (!value) {
    return null;
  }
  return {
    title: [
      {
        text: {
          content: value,
        },
      },
    ],
  };
}

function buildRichText(value) {
  if (!value) {
    return null;
  }
  return {
    rich_text: [
      {
        text: {
          content: value,
        },
      },
    ],
  };
}

function buildNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return { number: parsed };
}

function buildSelect(value) {
  if (!value) {
    return null;
  }
  return {
    select: {
      name: value,
    },
  };
}

function consolidateProperties(source) {
  return {
    data: {},
    sourceValues: source,
  };
}

function addProperty(target, name, builder, sourceKey) {
  const key = sourceKey || name;
  const value = target.sourceValues ? target.sourceValues[key] : null;
  if (!value) {
    return;
  }
  const built = builder(value);
  if (built) {
    target.data[name] = built;
  }
}

function notionPost(payload) {
  if (!NOTION_TOKEN) {
    return Promise.reject(new Error('NOTION_TOKEN must be set'));
  }
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      NOTION_API_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let chunked = '';
        res.on('data', (chunk) => {
          chunked += chunk;
        });
        res.on('end', () => {
          const success = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          if (success) {
            try {
              resolve(JSON.parse(chunked || '{}'));
            } catch (err) {
              reject(err);
            }
            return;
          }
          reject(new Error(`Notion API responded with ${res.statusCode}: ${chunked}`));
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function createProject(specData) {
  if (!specData.project['Project Name']) {
    throw new Error('Project Name is required in the spec');
  }
  const props = consolidateProperties(specData.project);
  addProperty(props, 'Project Key', buildTitle, 'Project Key');
  addProperty(props, 'Project Name', buildRichText, 'Project Name');
  addProperty(props, 'Repository', buildRichText, 'Repository');
  addProperty(props, 'Default Branch', buildRichText, 'Default Branch');
  addProperty(props, 'Status', buildSelect, 'Status');
  addProperty(props, 'Description', buildRichText, 'Description');

  const payload = {
    parent: {
      database_id: PROJECTS_DB_ID,
    },
    properties: props.data,
  };

  const created = await notionPost(payload);
  console.log('PROJECT_PAGE_ID', created.id);
  return created.id;
}

async function createTickets(specData, projectPageId) {
  if (!Array.isArray(specData.tickets) || specData.tickets.length === 0) {
    throw new Error('No tickets defined in the spec');
  }
  if (!projectPageId) {
    throw new Error('Project page id is required to create tickets');
  }

  for (const ticket of specData.tickets) {
    const props = consolidateProperties(ticket);
    addProperty(props, 'Title', buildTitle, 'Title');
    addProperty(props, 'Ticket Number', buildNumber, 'Ticket Number');
    addProperty(props, 'Priority', buildSelect, 'Priority');
    addProperty(props, 'Status', buildSelect, 'Status');
    addProperty(props, 'Type', buildSelect, 'Type');
    addProperty(props, 'Branch', buildRichText, 'Branch');
    props.data.Project = {
      relation: [
        {
          id: projectPageId,
        },
      ],
    };

    const payload = {
      parent: {
        database_id: TICKETS_DB_ID,
      },
      properties: props.data,
    };

    const created = await notionPost(payload);
    console.log('TICKET_PAGE_ID', created.id);
  }
}

function parseArgs(argv) {
  const args = {
    spec: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--spec') {
      args.spec = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return args;
}

function showUsage() {
  console.error('Usage: node notion-init.js --spec <path-to-spec>');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.spec) {
    showUsage();
    return;
  }
  ensureNotionConfig();
  const specPath = resolveSpecPath(options.spec);
  const specData = parseSpec(specPath);
  const projectPageId = await createProject(specData);
  await createTickets(specData, projectPageId);
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
