#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const path = require('path');

const {
  defaultSpecPath,
  writeSpecFile,
  applyInitDefaults,
  normalizeTicketNumber,
  generateInitTickets,
} = require('./notion-rules');

const PROJECTS_DB_ID = 'f5124c3d-1b2c-47da-87af-9d062d01fde7';
const TICKETS_DB_ID = '6574df08-bf7c-4813-906f-5f3f3f819908';
const NOTION_VERSION = '2022-06-28';
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_TOKEN = 'ntn_b86750914948HHTVYnnygGdDMwvD6YlJxuiVw5TqmyWe47';

function resolveSpecPath(specArg, projectRoot) {
  if (specArg) {
    return path.isAbsolute(specArg) ? specArg : path.resolve(projectRoot, specArg);
  }
  return defaultSpecPath(projectRoot);
}

async function findProjectByKey(projectKey) {
  if (!projectKey) {
    return null;
  }
  const payload = {
    filter: {
      property: 'Project Key',
      title: {
        equals: projectKey,
      },
    },
    page_size: 1,
  };
  const result = await queryDatabase(PROJECTS_DB_ID, payload);
  return result.results && result.results.length > 0 ? result.results[0].id : null;
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

function buildDate(value) {
  if (!value) {
    return null;
  }
  return {
    date: {
      start: value,
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

function notionRequest(url, payload, method = 'POST') {
  if (!NOTION_TOKEN) {
    return Promise.reject(new Error('NOTION_TOKEN must be set'));
  }
  const body = JSON.stringify(payload);
  const parsedUrl = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
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

function notionPost(payload) {
  return notionRequest(NOTION_API_URL, payload, 'POST');
}

function queryDatabase(databaseId, payload) {
  return notionRequest(`https://api.notion.com/v1/databases/${databaseId}/query`, payload, 'POST');
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
  console.log(`Project created: ${specData.project['Project Name']}`);
  return created.id;
}

async function createTickets(specData, projectPageId) {
  if (!Array.isArray(specData.tickets) || specData.tickets.length === 0) {
    throw new Error('No tickets defined in the spec');
  }
  if (!projectPageId) {
    throw new Error('Project page id is required to create tickets');
  }

  const seenNumbers = new Set();
  for (const ticket of specData.tickets) {
    const rawNumber = ticket['Ticket Number'];
    const number = normalizeTicketNumber(rawNumber);
    if (number === null) {
      console.log(`Skipping ticket with invalid Ticket Number: ${rawNumber}`);
      continue;
    }
    if (seenNumbers.has(number)) {
      console.log(`Skipping duplicate Ticket Number in spec: ${number}`);
      continue;
    }
    seenNumbers.add(number);

    const props = consolidateProperties(ticket);
    addProperty(props, 'Title', buildTitle, 'Title');
    addProperty(props, 'Ticket Number', buildNumber, 'Ticket Number');
    addProperty(props, 'Priority', buildSelect, 'Priority');
    addProperty(props, 'Status', buildSelect, 'Status');
    addProperty(props, 'Type', buildSelect, 'Type');
    addProperty(props, 'Branch', buildRichText, 'Branch');
    addProperty(props, 'Dev Notes', buildRichText, 'Dev Notes');
    addProperty(props, 'Last Synced', buildDate, 'Last Synced');
    addProperty(props, 'Latest Commit', buildRichText, 'Latest Commit');
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

    const displayNumber = String(number).padStart(3, '0');
    await notionPost(payload);
    console.log(`Ticket ${displayNumber} created: ${ticket.Title}`);
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
  console.error('Usage: node notion-init.js init [--spec <path-to-spec>]');
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (command !== 'init') {
    showUsage();
    return;
  }
  const projectRoot = process.cwd();
  const options = parseArgs(rest);
  const specPath = resolveSpecPath(options.spec, projectRoot);
  const readmePath = path.join(projectRoot, 'README.md');

  const specData = { project: {}, tickets: [] };
  const projectName = path.basename(projectRoot);
  const initTickets = generateInitTickets(projectRoot, readmePath, projectName);
  specData.tickets = initTickets.tickets;

  if (!specData.tickets || specData.tickets.length === 0) {
    throw new Error('No tickets generated from README or folder structure.');
  }

  const changed = applyInitDefaults(specData, projectRoot);
  writeSpecFile(specPath, specData);

  console.log(`README: ${initTickets.usedReadme || readmePath}`);
  console.log(
    `Modules: ${initTickets.modules.map((module) => module.title).join(', ') || 'none'}`
  );
  for (const ticket of specData.tickets) {
    console.log(`Ticket ${ticket['Ticket Number']}: ${ticket.Title}`);
  }
  console.log(`Spec: ${specPath}`);

  const existingProjectId = await findProjectByKey(specData.project['Project Key']);
  if (existingProjectId) {
    console.error(
      `Project '${specData.project['Project Name']}' is already initialized.\n` +
        'Initialization is a one-time operation.\n' +
        "Use 'node Notion-API/tools/notion-sync.js sync' for daily updates."
    );
    process.exit(1);
  }
  const projectPageId = await createProject(specData);
  await createTickets(specData, projectPageId);
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
