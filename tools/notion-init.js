#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync } = require('child_process');

const PROJECTS_DB_ID = 'f5124c3d-1b2c-47da-87af-9d062d01fde7';
const TICKETS_DB_ID = '6574df08-bf7c-4813-906f-5f3f3f819908';
const NOTION_VERSION = '2022-06-28';
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_TOKEN = 'ntn_b86750914948HHTVYnnygGdDMwvD6YlJxuiVw5TqmyWe47';

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

async function maybeFindProjectPageId(specData) {
  const key = specData.project['Project Key'];
  const name = specData.project['Project Name'];
  const filters = [];
  if (key) {
    filters.push({
      property: 'Project Key',
      title: {
        equals: key,
      },
    });
  }
  if (name) {
    filters.push({
      property: 'Project Name',
      rich_text: {
        equals: name,
      },
    });
  }
  if (filters.length === 0) {
    return null;
  }
  const payload = {
    filter: filters.length === 1 ? filters[0] : { or: filters },
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
  console.log(`Project created: ${created.id}`);
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
    const number = Number(rawNumber);
    if (Number.isNaN(number)) {
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
    console.log(`Ticket ${number} created: ${created.id}`);
  }
}

function parseArgs(argv) {
  const args = {
    spec: null,
    unknown: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--spec') {
      args.spec = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      args.unknown.push(token);
      continue;
    }
  }
  return args;
}

function showUsage() {
  console.error('Usage: node notion-init.js init [--spec <path-to-spec>]');
}

let cachedRepoRoot = null;

function resolveRepoRoot() {
  if (cachedRepoRoot !== null) {
    return cachedRepoRoot;
  }
  const candidates = [process.cwd(), path.resolve(__dirname, '..')];
  for (const candidate of candidates) {
    try {
      const result = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf8',
        cwd: candidate,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (result) {
        cachedRepoRoot = result;
        return cachedRepoRoot;
      }
    } catch (error) {
      continue;
    }
  }
  cachedRepoRoot = null;
  return null;
}

function assertGitRepo(repoRoot) {
  try {
    const inside = execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf8', cwd: repoRoot }).trim();
    if (inside !== 'true') {
      throw new Error('Not inside a git repository. Aborting.');
    }
  } catch (error) {
    throw new Error('Not inside a git repository. Aborting.');
  }

  try {
    execSync('git symbolic-ref -q HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: repoRoot });
  } catch (error) {
    throw new Error('Detached HEAD state detected. Aborting.');
  }

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: repoRoot }).trim();
    if (branch === 'main') {
      throw new Error('Init cannot run on main branch. Aborting.');
    }
  } catch (error) {
    if (error.message && error.message.includes('Init cannot run on main branch')) {
      throw error;
    }
    throw new Error('Failed to determine current branch. Aborting.');
  }
}

function runGit(command, failureMessage, cwd) {
  try {
    return execSync(command, { encoding: 'utf8', cwd }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const suffix = stderr ? `: ${stderr}` : '';
    throw new Error(`${failureMessage}${suffix}`);
  }
}

function ensureGitBranches(specData, repoRoot) {
  assertGitRepo(repoRoot);

  const ignore = new Set(['main', 'master', 'HEAD']);
  const detected = [];
  const skipped = new Set();
  const seen = new Set();

  for (const ticket of specData.tickets || []) {
    const branch = (ticket.Branch || '').trim();
    if (!branch || ignore.has(branch)) {
      skipped.add(branch || '<empty>');
      continue;
    }
    if (seen.has(branch)) {
      continue;
    }
    seen.add(branch);
    detected.push(branch);
  }

  console.log(`Detected ticket branches: ${detected.length > 0 ? detected.join(', ') : '(none)'}`);
  for (const branch of skipped) {
    console.log(`Skipped branch: ${branch}`);
  }

  if (detected.length === 0) {
    return;
  }

  const existing = new Set(
    runGit(
      'git for-each-ref --format="%(refname:short)" refs/heads',
      'Failed to list git branches',
      repoRoot
    )
      .split(/\r?\n/)
      .filter(Boolean)
  );

  for (const branch of detected) {
    if (existing.has(branch)) {
      console.log(`Branch already exists: ${branch}`);
      continue;
    }
    runGit(`git branch ${branch}`, `Failed to create git branch ${branch}`, repoRoot);
    existing.add(branch);
    console.log(`Created git branch: ${branch}`);
  }
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function limitWords(text, maxWords) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

function deriveProjectInfo(projectRoot) {
  const name = path.basename(projectRoot);
  const key = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'PROJECT';
  return {
    'Project Key': key,
    'Project Name': name,
    Repository: name,
    'Default Branch': 'main',
    Status: 'Active',
  };
}

function extractReadmeSections(projectRoot) {
  const readmePath = path.join(projectRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return [];
  }
  const raw = fs.readFileSync(readmePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^##\s+(.*)$/);
    if (match) {
      if (current) {
        sections.push(current);
      }
      current = { title: match[1].trim(), body: [] };
      continue;
    }
    if (!current) {
      continue;
    }
    current.body.push(line);
  }
  if (current) {
    sections.push(current);
  }
  return sections.map((section) => ({
    title: section.title,
    content: section.body.join('\n').trim(),
  }));
}

function extractReadmeSummary(projectRoot) {
  const readmePath = path.join(projectRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return '';
  }
  const raw = fs.readFileSync(readmePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('#')) {
      continue;
    }
    return trimmed;
  }
  return '';
}

function listFallbackFolders(projectRoot) {
  const excluded = new Set([
    '.git',
    'docs',
    'specs',
    'tools',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'vendor',
  ]);
  return fs
    .readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && !excluded.has(name));
}

function normalizeTicketTitle(rawTitle) {
  const title = rawTitle.trim() || 'Untitled';
  return limitWords(title, 3);
}

function buildTicketBranch(base, usedBranches, fallbackSuffix) {
  const slug = slugify(base) || `ticket-${fallbackSuffix}`;
  let candidate = `chore/${slug}`;
  let counter = 1;
  while (usedBranches.has(candidate)) {
    candidate = `chore/${slug}-${counter}`;
    counter += 1;
  }
  usedBranches.add(candidate);
  return candidate;
}

function buildTicketsFromSections(sections) {
  const usedBranches = new Set();
  return sections.map((section, index) => {
    const title = normalizeTicketTitle(section.title);
    const devNotes = (section.content || section.title).replace(/\s+/g, ' ').trim();
    const branch = buildTicketBranch(section.title, usedBranches, index + 1);
    return {
      Title: title,
      'Ticket Number': String(index + 1).padStart(3, '0'),
      Priority: 'Medium',
      Status: 'Backlog',
      Type: 'Feature',
      Branch: branch,
      'Dev Notes': devNotes,
    };
  });
}

function buildTicketsFromFolders(folders) {
  const usedBranches = new Set();
  return folders.map((folder, index) => {
    const title = normalizeTicketTitle(folder.replace(/[-_]+/g, ' '));
    const branch = buildTicketBranch(folder, usedBranches, index + 1);
    return {
      Title: title,
      'Ticket Number': String(index + 1).padStart(3, '0'),
      Priority: 'Medium',
      Status: 'Backlog',
      Type: 'Feature',
      Branch: branch,
      'Dev Notes': `Folder: ${folder}`,
    };
  });
}

function buildSpecData(projectRoot) {
  const project = deriveProjectInfo(projectRoot);
  const summary = extractReadmeSummary(projectRoot);
  if (summary) {
    project.Description = summary;
  }
  const sections = extractReadmeSections(projectRoot);
  let tickets =
    sections.length > 0 ? buildTicketsFromSections(sections) : buildTicketsFromFolders(listFallbackFolders(projectRoot));
  if (tickets.length === 0) {
    tickets = [
      {
        Title: 'Project Setup',
        'Ticket Number': '001',
        Priority: 'Medium',
        Status: 'Backlog',
        Type: 'Feature',
        Branch: 'chore/project-setup',
        'Dev Notes': 'Bootstrap initial project structure and documentation.',
      },
    ];
  }
  return { project, tickets };
}

function serializeSpec(specData) {
  const lines = ['Project:'];
  const projectKeys = [
    'Project Key',
    'Project Name',
    'Repository',
    'Default Branch',
    'Status',
    'Description',
  ];
  for (const key of projectKeys) {
    if (specData.project[key]) {
      lines.push(`- ${key}: ${specData.project[key]}`);
    }
  }
  lines.push('', 'Tickets:');
  for (const ticket of specData.tickets) {
    lines.push(`- Title: ${ticket.Title}`);
    lines.push(`  Ticket Number: ${ticket['Ticket Number']}`);
    lines.push(`  Priority: ${ticket.Priority}`);
    lines.push(`  Status: ${ticket.Status}`);
    lines.push(`  Type: ${ticket.Type}`);
    lines.push(`  Branch: ${ticket.Branch}`);
    lines.push(`  Dev Notes: ${ticket['Dev Notes']}`);
  }
  return `${lines.join('\n')}\n`;
}

function generateSpecIfMissing(projectRoot, specPath) {
  if (fs.existsSync(specPath)) {
    return null;
  }
  const specData = buildSpecData(projectRoot);
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, serializeSpec(specData), 'utf8');
  console.log(`Spec generated at ${specPath}`);
  return specData;
}

function resolveDefaultSpecPath(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'specs', 'notion-init.md'),
    path.join(projectRoot, 'docs', 'notion-init.md'),
  ];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing || candidates[0];
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (command !== 'init') {
    showUsage();
    return;
  }
  const options = parseArgs(rest);
  if (options.unknown.length > 0) {
    showUsage();
    return;
  }
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error('Not inside a git repository. Aborting.');
    return;
  }
  assertGitRepo(repoRoot);
  const projectRoot = repoRoot;
  let specPath = options.spec ? resolveSpecPath(options.spec) : resolveDefaultSpecPath(projectRoot);
  let specData = null;

  if (!options.spec) {
    const preflightProject = deriveProjectInfo(projectRoot);
    const existingProjectId = await maybeFindProjectPageId({ project: preflightProject });
    if (existingProjectId) {
      console.log(`Project already exists (${existingProjectId}). Aborting.`);
      return;
    }
    specData = generateSpecIfMissing(projectRoot, specPath);
  }

  if (!specData) {
    specData = parseSpec(specPath);
  }
  const existingProjectId = await maybeFindProjectPageId(specData);
  if (existingProjectId) {
    console.log(`Project already exists (${existingProjectId}). Aborting.`);
    return;
  }
  ensureGitBranches(specData, repoRoot);
  const projectPageId = await createProject(specData);
  await createTickets(specData, projectPageId);
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
