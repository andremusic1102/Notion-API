#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// internal / local use
const NOTION_TOKEN = process.env.NOTION_TOKEN;

const PROJECTS_DB_ID = process.env.NOTION_PROJECTS_DB_ID;
const TICKETS_DB_ID = process.env.NOTION_TICKETS_DB_ID;
const NOTION_VERSION = '2022-06-28';
const DEFAULT_SPEC_NAME = 'notion-init.md';
let REPO_PATH = process.cwd();

function setRepoContext(repoPath) {
  if (repoPath) {
    REPO_PATH = repoPath;
  }
}

function defaultSpecPath(repoRoot) {
  const base = repoRoot || REPO_PATH || process.cwd();
  return path.join(base, DEFAULT_SPEC_NAME);
}

function resolveSpecPath(specArg, repoRoot) {
  if (!specArg) {
    return defaultSpecPath(repoRoot);
  }
  const base = repoRoot || REPO_PATH || process.cwd();
  return path.isAbsolute(specArg) ? specArg : path.resolve(base, specArg);
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

function runGitCommand(args, cwdOverride) {
  const result = spawnSync('git', args, { encoding: 'utf8', cwd: cwdOverride || REPO_PATH });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function runGitCommandStatus(args, cwdOverride) {
  const result = spawnSync('git', args, { stdio: 'inherit', cwd: cwdOverride || REPO_PATH });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed`);
  }
}

function sanitizeRepoName(url) {
  const cleaned = url.replace(/\/+$/, '').split('/').pop() || 'repo';
  return cleaned.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-');
}

function repoCacheDir() {
  return path.join(os.tmpdir(), 'notion-api-repos');
}

function ensureRepoFromUrl(repoUrl) {
  if (!repoUrl) {
    throw new Error('Missing --repo-url');
  }
  const baseDir = repoCacheDir();
  fs.mkdirSync(baseDir, { recursive: true });
  const hash = crypto.createHash('sha1').update(repoUrl).digest('hex').slice(0, 8);
  const repoName = sanitizeRepoName(repoUrl);
  const targetPath = path.join(baseDir, `${repoName}-${hash}`);
  const gitDir = path.join(targetPath, '.git');
  if (fs.existsSync(gitDir)) {
    runGitCommandStatus(['fetch', '--all', '--prune'], targetPath);
    return targetPath;
  }
  runGitCommandStatus(['clone', repoUrl, targetPath], undefined);
  return targetPath;
}

function resolveRepoPath(options) {
  if (options.repoUrl) {
    return ensureRepoFromUrl(options.repoUrl);
  }
  if (options.repo) {
    return path.isAbsolute(options.repo) ? options.repo : path.resolve(process.cwd(), options.repo);
  }
  return process.cwd();
}

function extractShortTitle(fullTitle) {
  if (!fullTitle) {
    return '';
  }
  const cjkChars = [];
  for (const char of fullTitle) {
    if (/[\u4E00-\u9FFF]/.test(char)) {
      cjkChars.push(char);
    }
  }
  if (cjkChars.length > 0) {
    return cjkChars.slice(0, 3).join('');
  }
  const words = fullTitle.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(' ');
}

function getRepoName() {
  try {
    const url = runGitCommand(['remote', 'get-url', 'origin']).trim();
    if (url) {
      const cleaned = url.replace(/\/+$/, '');
      const name = cleaned.split('/').pop() || cleaned;
      return name.replace(/\.git$/i, '');
    }
  } catch (error) {
    // ignore
  }
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    return 'repo';
  }
  return path.basename(repoRoot);
}

function getRepoUrl() {
  try {
    const url = runGitCommand(['remote', 'get-url', 'origin']).trim();
    return url || null;
  } catch (error) {
    return null;
  }
}

function getDefaultBranchName() {
  try {
    const head = runGitCommand(['symbolic-ref', '-q', '--short', 'HEAD']).trim();
    if (head) {
      return head;
    }
  } catch (error) {
    // ignore
  }
  return 'main';
}

function parseReadmeTodos(repoRoot) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return [];
  }
  const raw = fs.readFileSync(readmePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const todos = [];
  let inTodos = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inTodos) {
      if (/^##\s+TODOs\b/i.test(trimmed)) {
        inTodos = true;
      }
      continue;
    }
    if (/^#+\s+/.test(trimmed)) {
      break;
    }
    if (!trimmed) {
      continue;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (listMatch && listMatch[1]) {
      todos.push(listMatch[1].trim());
      continue;
    }
    todos.push(trimmed);
  }
  return todos;
}

function writeSpecFromReadme(repoRoot, specPath, todos) {
  const repoName = getRepoName();
  const repoUrl = getRepoUrl() || repoName;
  const defaultBranch = getDefaultBranchName();
  const projectKey = `${repoName}-001`;
  const description = 'Generated from README TODOs';

  const headerLines = [
    'Project:',
    `- Project Key: ${projectKey}`,
    `- Project Name: ${repoName}`,
    `- Repository: ${repoUrl}`,
    `- Default Branch: ${defaultBranch}`,
    '- Status: Active',
    `- Description: ${description}`,
    '',
    'Tickets:',
  ];

  const ticketLines = [];
  if (Array.isArray(todos)) {
    todos.forEach((title, index) => {
      const number = index + 1;
      ticketLines.push(
        `- Title: ${title}`,
        `  Ticket Number: ${number}`,
        `  Priority: Medium`,
        `  Status: Backlog`,
        `  Type: Tech Debt`
      );
    });
  }

  const content = `${headerLines.join('\n')}\n${ticketLines.join('\n')}\n`;
  fs.writeFileSync(specPath, content, 'utf8');
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
      projectLines.push(trimmed);
    } else if (section === 'tickets') {
      ticketLines.push(trimmed);
    }
  }

  const project = {};
  for (const line of projectLines) {
    const normalized = line.replace(/^-+\s*/, '');
    const parsed = splitKeyValue(normalized);
    if (parsed) {
      project[parsed.key] = parsed.value;
    }
  }

  const tickets = [];
  let currentTicket = null;
  for (const line of ticketLines) {
    const normalized = line.replace(/^-+\s*/, '');
    if (normalized.startsWith('Title:')) {
      if (currentTicket) {
        tickets.push(currentTicket);
      }
      currentTicket = {};
      const parsed = splitKeyValue(normalized);
      if (parsed) {
        const shortTitle = extractShortTitle(parsed.value);
        currentTicket.Title = shortTitle || parsed.value;
        currentTicket['Dev Notes'] = parsed.value;
      }
      continue;
    }
    if (!currentTicket) {
      continue;
    }
    const parsed = splitKeyValue(normalized);
    if (parsed) {
      currentTicket[parsed.key] = parsed.value;
    }
  }
  if (currentTicket) {
    tickets.push(currentTicket);
  }

  return { project, tickets };
}

function titleFromBranch(branch) {
  if (!branch) {
    return 'General';
  }
  const parts = branch.split('/').slice(1).join('-').split(/[-_]+/).filter(Boolean);
  const words = parts.slice(0, 3);
  if (words.length === 0) {
    return branch;
  }
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim();
}

function buildDevNotes(projectName, description, branch, commits) {
  const messages = (commits || []).map((commit) => commit.message).filter(Boolean);
  const context = description ? ` ${description}` : '';
  const commitText = messages.length > 0 ? ` Today's commits: ${messages.join('; ')}.` : '';
  return `${projectName || 'Project'} update for ${branch}.${context}${commitText}`.trim();
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

function addProperty(properties, name, builder, sourceName) {
  const value = properties.sourceValues ? properties.sourceValues[sourceName || name] : null;
  if (!value) {
    return;
  }
  const built = builder(value);
  if (built) {
    properties.data[name] = built;
  }
}

function notionRequest(url, payload, method = 'POST') {
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
  return notionRequest('https://api.notion.com/v1/pages', payload);
}

function notionPatch(url, payload) {
  return notionRequest(url, payload, 'PATCH');
}

function notionComment(payload) {
  return notionRequest('https://api.notion.com/v1/comments', payload, 'POST');
}

function notionPatch(url, payload) {
  return notionRequest(url, payload, 'PATCH');
}

function consolidateProperties(source) {
  return {
    data: {},
    sourceValues: source,
  };
}

function getSelectName(properties, name) {
  return properties && properties[name] && properties[name].select
    ? properties[name].select.name
    : null;
}

function getRichTextValue(properties, name) {
  const richText = properties && properties[name] ? properties[name].rich_text : null;
  if (!Array.isArray(richText) || richText.length === 0) {
    return null;
  }
  return richText.map((item) => item.plain_text || '').join('');
}

function getTitleValue(properties, name) {
  const title = properties && properties[name] ? properties[name].title : null;
  if (!Array.isArray(title) || title.length === 0) {
    return null;
  }
  return title.map((item) => item.plain_text || '').join('');
}

function getNumberValue(properties, name) {
  if (!properties || !properties[name]) {
    return null;
  }
  return properties[name].number;
}

function getDateValue(properties, name) {
  if (!properties || !properties[name] || !properties[name].date) {
    return null;
  }
  return properties[name].date.start || null;
}

function getStatusBranch() {
  try {
    const output = runGitCommand(['status', '--porcelain', '-b']);
    const firstLine = output.split('\n')[0] || '';
    const match = firstLine.match(/^##\s+([^\s.]+)/);
    if (!match) {
      return null;
    }
    const branch = match[1];
    return branch === 'HEAD' ? null : branch;
  } catch (error) {
    return null;
  }
}

async function createProject(specPath) {
  const parsed = parseSpec(specPath);
  if (!parsed.project['Project Name']) {
    throw new Error('Project Name is required in the spec');
  }
  const props = consolidateProperties(parsed.project);
  addProperty(props, 'Project Name', buildTitle, 'Project Name');
  addProperty(props, 'Project Key', buildRichText, 'Project Key');
  addProperty(props, 'Repository', buildRichText, 'Repository');
  addProperty(props, 'Default Branch', buildRichText, 'Default Branch');
  addProperty(props, 'Status', buildRichText, 'Status');
  addProperty(props, 'Description', buildRichText, 'Description');

  const payload = {
    parent: {
      database_id: PROJECTS_DB_ID,
    },
    properties: props.data,
  };
  const result = await notionPost(payload);
  console.log(result.id);
}

async function createTickets(specPath, projectPageId) {
  const parsed = parseSpec(specPath);
  if (!Array.isArray(parsed.tickets) || parsed.tickets.length === 0) {
    throw new Error('No tickets defined in the spec');
  }
  if (!projectPageId) {
    throw new Error('Project page id is required to create tickets');
  }
  for (const ticket of parsed.tickets) {
    const props = consolidateProperties(ticket);
    addProperty(props, 'Title', buildTitle, 'Title');
    addProperty(props, 'Ticket Number', buildNumber, 'Ticket Number');
    addProperty(props, 'Priority', buildSelect, 'Priority');
    addProperty(props, 'Status', buildSelect, 'Status');
    addProperty(props, 'Type', buildSelect, 'Type');
    addProperty(props, 'Branch', buildRichText, 'Branch');
    addProperty(props, 'Dev Notes', buildRichText, 'Dev Notes');
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
    console.log(created.id);
  }
}

async function queryDatabase(databaseId, payload) {
  return notionRequest(`https://api.notion.com/v1/databases/${databaseId}/query`, payload, 'POST');
}

async function findTicketByNumber(number, cache) {
  if (number === null || number === undefined) {
    return null;
  }
  const key = String(number);
  if (cache[key]) {
    return cache[key];
  }
  const payload = {
    filter: {
      property: 'Ticket Number',
      number: {
        equals: Number(number),
      },
    },
    page_size: 1,
  };
  const result = await queryDatabase(TICKETS_DB_ID, payload);
  const page = result.results && result.results.length > 0 ? result.results[0] : null;
  cache[key] = page || null;
  return page || null;
}

async function findProjectPageId(specData) {
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
    throw new Error('Project Key or Project Name is required in the spec');
  }
  const payload = {
    filter: filters.length === 1 ? filters[0] : { or: filters },
    page_size: 1,
  };
  const result = await queryDatabase(PROJECTS_DB_ID, payload);
  const pageId = result.results && result.results.length > 0 ? result.results[0].id : null;
  if (!pageId) {
    throw new Error('Project not found in Notion');
  }
  return pageId;
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

async function fetchTicketsByProject(projectPageId) {
  const tickets = [];
  let cursor = null;
  do {
    const payload = {
      filter: {
        property: 'Project',
        relation: {
          contains: projectPageId,
        },
      },
      page_size: 100,
    };
    if (cursor) {
      payload.start_cursor = cursor;
    }
    const result = await queryDatabase(TICKETS_DB_ID, payload);
    if (Array.isArray(result.results)) {
      tickets.push(...result.results);
    }
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return tickets;
}

function buildTicketPayloadFromSpec(ticket, projectPageId) {
  const props = consolidateProperties(ticket);
  addProperty(props, 'Title', buildTitle, 'Title');
  addProperty(props, 'Ticket Number', buildNumber, 'Ticket Number');
  addProperty(props, 'Priority', buildSelect, 'Priority');
  addProperty(props, 'Status', buildSelect, 'Status');
  addProperty(props, 'Type', buildSelect, 'Type');
  addProperty(props, 'Branch', buildRichText, 'Branch');
  addProperty(props, 'Dev Notes', buildRichText, 'Dev Notes');
  props.data.Project = {
    relation: [
      {
        id: projectPageId,
      },
    ],
  };
  return {
    parent: {
      database_id: TICKETS_DB_ID,
    },
    properties: props.data,
  };
}

async function updatePageProperties(pageId, properties) {
  if (!pageId || !properties || Object.keys(properties).length === 0) {
    return null;
  }
  return notionPatch(`https://api.notion.com/v1/pages/${pageId}`, { properties });
}

function resolveRepoRoot() {
  try {
    return runGitCommand(['rev-parse', '--show-toplevel']).trim();
  } catch (error) {
    return null;
  }
}

async function appendTicketsToSpec(specPath, tickets) {
  if (!tickets || tickets.length === 0) {
    return 0;
  }
  const content = fs.readFileSync(specPath, 'utf8');
  const endsWithNewline = content.endsWith('\n');
  const lines = [];
  if (!endsWithNewline) {
    lines.push('');
  }
  for (const ticket of tickets) {
    lines.push(
      `- Title: ${ticket.Title}`,
      `  Ticket Number: ${ticket['Ticket Number']}`,
      `  Priority: ${ticket.Priority}`,
      `  Status: ${ticket.Status}`,
      `  Type: ${ticket.Type}`,
      `  Branch: ${ticket.Branch}`,
      `  Dev Notes: ${ticket['Dev Notes']}`
    );
  }
  fs.appendFileSync(specPath, `${lines.join('\n')}\n`, 'utf8');
  return tickets.length;
}

async function updateSpecFromGit(specPath) {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    throw new Error('Unable to resolve git repo root');
  }
  const resolvedSpecPath = specPath || defaultSpecPath(repoRoot);
  const todos = parseReadmeTodos(repoRoot);
  if (!fs.existsSync(resolvedSpecPath)) {
    writeSpecFromReadme(repoRoot, resolvedSpecPath, todos);
    if (todos.length === 0) {
      console.log('No TODOs found in README.md');
      return { appendedCount: 0, specPath: resolvedSpecPath, groupedCommits: new Map() };
    }
    console.log(`Created spec with ${todos.length} tickets from README TODOs`);
    return { appendedCount: todos.length, specPath: resolvedSpecPath, groupedCommits: new Map() };
  }
  if (todos.length === 0) {
    console.log('No TODOs found in README.md');
    return { appendedCount: 0, specPath: resolvedSpecPath, groupedCommits: new Map() };
  }

  const raw = fs.readFileSync(resolvedSpecPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const ticketStartIndex = lines.findIndex((line) => line.trim().startsWith('Tickets:'));
  const headerLines = ticketStartIndex >= 0 ? lines.slice(0, ticketStartIndex + 1) : lines;

  const ticketLines = [];
  todos.forEach((title, index) => {
    const number = index + 1;
    ticketLines.push(
      `- Title: ${title}`,
      `  Ticket Number: ${number}`,
      `  Priority: Medium`,
      `  Status: Backlog`,
      `  Type: Tech Debt`
    );
  });

  const newContent = `${headerLines.join('\n')}\n${ticketLines.join('\n')}\n`;
  fs.writeFileSync(resolvedSpecPath, newContent, 'utf8');
  console.log(`Updated spec with ${todos.length} tickets from README TODOs`);
  return { appendedCount: todos.length, specPath: resolvedSpecPath, groupedCommits: new Map() };
}

function normalizeSince(value) {
  if (!value || value === 'today') {
    return 'midnight';
  }
  return value;
}

async function getLastSyncBaseline(specPath) {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.log('No Last Synced found, falling back to today');
    return 'midnight';
  }
  const resolvedSpecPath = specPath || defaultSpecPath(repoRoot);
  if (!fs.existsSync(resolvedSpecPath)) {
    console.log('No Last Synced found, falling back to today');
    return 'midnight';
  }
  const specData = parseSpec(resolvedSpecPath);
  let projectPageId = null;
  try {
    projectPageId = await findProjectPageId(specData);
  } catch (error) {
    console.log('No Last Synced found, falling back to today');
    return 'midnight';
  }
  const tickets = await fetchTicketsByProject(projectPageId);
  let maxDate = null;
  for (const ticket of tickets) {
    const lastSynced = getDateValue(ticket.properties, 'Last Synced');
    if (!lastSynced) {
      continue;
    }
    if (!maxDate || new Date(lastSynced) > new Date(maxDate)) {
      maxDate = lastSynced;
    }
  }
  if (!maxDate) {
    console.log('No Last Synced found, falling back to today');
    return 'midnight';
  }
  return maxDate;
}

function parseGitLog(sinceValue) {
  const format = '%H%x1F%an%x1F%s%x1F%cI%x1F%d%x1E';
  const output = runGitCommand([
    'log',
    `--since=${sinceValue}`,
    `--pretty=format:${format}`,
    '--decorate=short',
  ]).trim();
  if (!output) {
    return [];
  }
  return output
    .split('\x1E')
    .filter(Boolean)
    .map((entry) => {
      const [hash, author, message, isoDate, decoration] = entry.split('\x1F');
      return {
        hash,
        author,
        message,
        date: isoDate,
        decoration: decoration || '',
      };
    });
}

function extractBranchFromDecorations(decoration) {
  if (!decoration) {
    return null;
  }
  const cleaned = decoration.replace(/[()]/g, '').trim();
  if (!cleaned) {
    return null;
  }
  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes('->')) {
      const [, target] = part.split('->').map((value) => value.trim());
      if (target && !target.startsWith('tag:') && !target.startsWith('origin/')) {
        return target;
      }
      continue;
    }
    if (part === 'HEAD' || part.startsWith('tag:') || part.startsWith('origin/')) {
      continue;
    }
    return part;
  }
  return null;
}

function getBranchesContainingCommit(commitHash) {
  try {
    const output = runGitCommand(['branch', '--contains', commitHash]);
    return output
      .split('\n')
      .map((line) => line.replace('*', '').trim())
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function extractBranchFromMessage(message) {
  if (!message) {
    return null;
  }
  const match = message.match(/branch[:=]\s*([\w\/.-]+)/i);
  return match ? match[1] : null;
}

function determineBranch(commit, fallbackBranch) {
  const fromDecor = extractBranchFromDecorations(commit.decoration);
  if (fromDecor) {
    return fromDecor;
  }
  const branches = getBranchesContainingCommit(commit.hash);
  for (const branch of branches) {
    if (!branch.startsWith('origin/') && branch !== 'HEAD') {
      return branch;
    }
  }
  const fromMessage = extractBranchFromMessage(commit.message);
  if (fromMessage) {
    return fromMessage;
  }
  return fallbackBranch;
}

function shortHash(hash) {
  if (!hash) {
    return '';
  }
  return hash.slice(0, 7);
}

async function findTicketForBranch(branchName, cache) {
  if (!branchName) {
    return null;
  }
  if (cache[branchName]) {
    return cache[branchName];
  }
  const payload = {
    filter: {
      property: 'Branch',
      rich_text: {
        equals: branchName,
      },
    },
    page_size: 1,
  };
  const result = await queryDatabase(TICKETS_DB_ID, payload);
  const page = result.results && result.results.length > 0 ? result.results[0] : null;
  cache[branchName] = page || null;
  return page || null;
}

async function postCommitComment(pageId, commit) {
  if (!pageId) {
    return;
  }
  const dateText = commit.date ? commit.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const payload = {
    parent: {
      page_id: pageId,
    },
    rich_text: [
      {
        text: {
          content: `${dateText}\n${shortHash(commit.hash)}\n${commit.message}`,
        },
      },
    ],
  };
  await notionComment(payload);
}

function currentBranchName() {
  try {
    return runGitCommand(['symbolic-ref', '-q', '--short', 'HEAD']).trim();
  } catch (error) {
    return null;
  }
}

function groupCommitsByBranch(commits, fallbackBranch) {
  const grouped = new Map();
  const ordered = [...commits].reverse();
  for (const commit of ordered) {
    const branch = determineBranch(commit, fallbackBranch);
    if (!branch) {
      grouped.set(null, (grouped.get(null) || []).concat(commit));
      continue;
    }
    const list = grouped.get(branch) || [];
    list.push(commit);
    grouped.set(branch, list);
  }
  return grouped;
}

function shouldAdvanceStatus(statusName, hasCommits) {
  return statusName === 'Backlog' && hasCommits;
}

function extractTicketNumberFromMessage(message, repoName) {
  if (!message || !repoName) {
    return null;
  }
  const escaped = repoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = message.match(new RegExp(`${escaped}-(\\d+)`, 'i'));
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

async function syncGitLog(sinceValue, options = {}) {
  let normalizedSince = normalizeSince(sinceValue);
  if (sinceValue === 'last-sync') {
    normalizedSince = await getLastSyncBaseline(options.specPath);
  }
  const commits = parseGitLog(normalizedSince);
  if (!commits.length) {
    if (!options.suppressNoChanges) {
      console.log('No changes');
    }
    return { changes: 0 };
  }
  const ticketCache = {};
  const repoName = getRepoName();
  const grouped = new Map();
  for (const commit of commits) {
    const number = extractTicketNumberFromMessage(commit.message, repoName);
    if (!number) {
      continue;
    }
    const list = grouped.get(number) || [];
    list.push(commit);
    grouped.set(number, list);
  }
  const nowIso = new Date().toISOString();
  let changes = 0;

  for (const [number, numberCommits] of grouped.entries()) {
    const ticket = await findTicketByNumber(number, ticketCache);
    if (!ticket) {
      console.log(`No ticket found for number ${number}`);
      continue;
    }
    const properties = ticket.properties || {};
    const ticketNumber = getNumberValue(properties, 'Ticket Number');
    const latestCommit = getRichTextValue(properties, 'Latest Commit');
    const statusName = getSelectName(properties, 'Status');
    const lastSynced = getDateValue(properties, 'Last Synced');

    const forced = options.forceCommentTicketIds && options.forceCommentTicketIds.has(ticket.id);
    const shouldSkipUntilFound =
      !forced &&
      latestCommit &&
      numberCommits.some((commit) => shortHash(commit.hash) === latestCommit);
    let startAppending = !shouldSkipUntilFound;
    let appendedAny = false;
    let newestCommit = null;

    const ordered = [...numberCommits].reverse();
    for (const commit of ordered) {
      const commitShort = shortHash(commit.hash);
      if (!startAppending) {
        if (commitShort === latestCommit) {
          startAppending = true;
        }
        continue;
      }
      await postCommitComment(ticket.id, commit);
      const ticketLabel = ticketNumber ? `${ticketNumber}` : ticket.id;
      console.log(`Appended commit ${commitShort} to ticket ${ticketLabel}`);
      appendedAny = true;
      newestCommit = commitShort;
      changes += 1;
    }

    const propertyUpdates = {};
    if (appendedAny && newestCommit && newestCommit !== latestCommit) {
      propertyUpdates['Latest Commit'] = buildRichText(newestCommit);
    }
    if (appendedAny) {
      propertyUpdates['Last Synced'] = buildDate(nowIso);
    }
    if (shouldAdvanceStatus(statusName, appendedAny)) {
      propertyUpdates.Status = buildSelect('In Progress');
    }
    if (Object.keys(propertyUpdates).length > 0) {
      await updatePageProperties(ticket.id, propertyUpdates);
      const ticketLabel = ticketNumber ? `${ticketNumber}` : ticket.id;
      console.log(`Updated ticket ${ticketLabel}`);
      changes += 1;
    }
  }
  if (changes === 0 && !options.suppressNoChanges) {
    console.log('No changes');
  }
  return { changes };
}

async function diffSync(specPath, options = {}) {
  const specData = parseSpec(specPath);
  if (!Array.isArray(specData.tickets) || specData.tickets.length === 0) {
    if (!options.suppressNoChanges) {
      console.log('No changes');
    }
    return { changes: 0, forceCommentTicketIds: new Set() };
  }
  const projectPageId = await findProjectPageId(specData);
  const existingTickets = await fetchTicketsByProject(projectPageId);
  const existingByNumber = new Map();
  for (const ticket of existingTickets) {
    const number = getNumberValue(ticket.properties, 'Ticket Number');
    if (number !== null && number !== undefined) {
      existingByNumber.set(number, ticket);
    }
  }

  const commits = parseGitLog('midnight');
  const repoName = getRepoName();
  const groupedCommits = new Map();
  for (const commit of commits) {
    const number = extractTicketNumberFromMessage(commit.message, repoName);
    if (!number) {
      continue;
    }
    const list = groupedCommits.get(number) || [];
    list.push(commit);
    groupedCommits.set(number, list);
  }
  const today = new Date().toISOString().slice(0, 10);
  let changes = 0;
  const forceCommentTicketIds = new Set();
  const seenNumbers = new Set();

  for (const ticketSpec of specData.tickets) {
    const rawNumber = ticketSpec['Ticket Number'];
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

    const hasCommits = groupedCommits.has(number) && groupedCommits.get(number).length > 0;
    const existing = existingByNumber.get(number);
    const numberCommits = groupedCommits.get(number) || [];
    const latestCommit = numberCommits.length > 0 ? shortHash(numberCommits[0].hash) : null;

    if (!existing) {
      const payload = buildTicketPayloadFromSpec(ticketSpec, projectPageId);
      payload.properties['Last Synced'] = buildDate(today);
      if (latestCommit) {
        payload.properties['Latest Commit'] = buildRichText(latestCommit);
      }
      const created = await notionPost(payload);
      console.log(`Created ticket ${number} (${created.id})`);
      changes += 1;
      if (hasCommits) {
        await updatePageProperties(created.id, { Status: buildSelect('In Progress') });
        console.log(`Updated ticket ${number} (${created.id}) status to In Progress`);
        changes += 1;
        forceCommentTicketIds.add(created.id);
      }
      continue;
    }

    const updates = {};
    const updatedFields = [];
    const statusName = getSelectName(existing.properties, 'Status');
    const lastSynced = getDateValue(existing.properties, 'Last Synced');
    const currentTitle = getTitleValue(existing.properties, 'Title');
    const currentDevNotes = getRichTextValue(existing.properties, 'Dev Notes');
    const currentPriority = getSelectName(existing.properties, 'Priority');
    const currentType = getSelectName(existing.properties, 'Type');

    if (ticketSpec.Title && ticketSpec.Title !== currentTitle) {
      updates.Title = buildTitle(ticketSpec.Title);
      updatedFields.push('Title');
    }
    if (ticketSpec['Dev Notes'] && ticketSpec['Dev Notes'] !== currentDevNotes) {
      updates['Dev Notes'] = buildRichText(ticketSpec['Dev Notes']);
      updatedFields.push('Dev Notes');
    }
    if (ticketSpec.Priority && ticketSpec.Priority !== currentPriority) {
      updates.Priority = buildSelect(ticketSpec.Priority);
      updatedFields.push('Priority');
    }
    if (ticketSpec.Type && ticketSpec.Type !== currentType) {
      updates.Type = buildSelect(ticketSpec.Type);
      updatedFields.push('Type');
    }
    if (shouldAdvanceStatus(statusName, hasCommits) && ticketSpec.Status === 'Backlog') {
      updates.Status = buildSelect('In Progress');
      updatedFields.push('Status');
    }
    if (lastSynced !== today) {
      updates['Last Synced'] = buildDate(today);
      updatedFields.push('Last Synced');
    }
    const existingLatestCommit = getRichTextValue(existing.properties, 'Latest Commit');
    if (latestCommit && latestCommit !== existingLatestCommit) {
      updates['Latest Commit'] = buildRichText(latestCommit);
      updatedFields.push('Latest Commit');
      forceCommentTicketIds.add(existing.id);
    }
    if (Object.keys(updates).length > 0) {
      await updatePageProperties(existing.id, updates);
      console.log(`Updated Ticket ${number}: [${updatedFields.join(', ')}]`);
      changes += 1;
    }
  }

  if (changes === 0 && !options.suppressNoChanges) {
    console.log('No changes');
  }
  return { changes, forceCommentTicketIds };
}

async function initProject(specPath) {
  const specData = parseSpec(specPath);
  const existingProjectId = await maybeFindProjectPageId(specData);
  if (existingProjectId) {
    throw new Error("Project already initialized. Use 'sync' instead.");
  }
  const projectProps = consolidateProperties(specData.project);
  addProperty(projectProps, 'Project Key', buildTitle, 'Project Key');
  addProperty(projectProps, 'Project Name', buildRichText, 'Project Name');
  addProperty(projectProps, 'Repository', buildRichText, 'Repository');
  addProperty(projectProps, 'Default Branch', buildRichText, 'Default Branch');
  addProperty(projectProps, 'Status', buildSelect, 'Status');
  addProperty(projectProps, 'Description', buildRichText, 'Description');

  const projectPayload = {
    parent: {
      database_id: PROJECTS_DB_ID,
    },
    properties: projectProps.data,
  };
  const project = await notionPost(projectPayload);
  console.log(`Created project ${project.id}`);

  const projectPageId = project.id;
  const existingTickets = await fetchTicketsByProject(projectPageId);
  const existingByNumber = new Map();
  for (const ticket of existingTickets) {
    const number = getNumberValue(ticket.properties, 'Ticket Number');
    if (number !== null && number !== undefined) {
      existingByNumber.set(number, ticket);
    }
  }

  let changes = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const ticketSpec of specData.tickets) {
    const rawNumber = ticketSpec['Ticket Number'];
    const number = Number(rawNumber);
    if (Number.isNaN(number)) {
      console.log(`Skipping ticket with invalid Ticket Number: ${rawNumber}`);
      continue;
    }
    if (existingByNumber.has(number)) {
      console.log(`Ticket ${number} already exists`);
      continue;
    }
    const payload = buildTicketPayloadFromSpec(ticketSpec, projectPageId);
    payload.properties['Last Synced'] = buildDate(today);
    const created = await notionPost(payload);
    console.log(`Created ticket ${number} (${created.id})`);
    changes += 1;
  }
  if (changes === 0) {
    console.log('No changes');
  }
}

async function syncDaily(specPath) {
  const invalidSince = process.argv.includes('--since');
  if (invalidSince) {
    console.error("Invalid command. Use 'init' for new projects or 'sync' for daily updates.");
    return;
  }
  const result = await syncGitLog('last-sync', { suppressNoChanges: true, specPath });
  if (result.changes === 0) {
    console.log('No changes today');
  }
}

function parseArgs(argv) {
  const args = {
    spec: null,
    repo: null,
    repoUrl: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--spec') {
      args.spec = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--repo') {
      args.repo = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--repo-url') {
      args.repoUrl = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return args;
}

function showUsage() {
  console.error(
    "Usage: node notion-sync.js <init|sync|spec-update|full-sync> --repo <path> | --repo-url <url> [--spec <path>]"
  );
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command) {
    showUsage();
    return;
  }
  const options = parseArgs(rest);
  const repoPath = resolveRepoPath(options);
  setRepoContext(repoPath);
  const specPath = resolveSpecPath(options.spec, repoPath);
  if (command === 'spec-update') {
    await updateSpecFromGit(specPath);
    return;
  }
  ensureNotionConfig();
  if (command === 'init') {
    await initProject(specPath);
    return;
  }
  if (command === 'sync') {
    await syncDaily(specPath);
    return;
  }
  if (command === 'full-sync') {
    await updateSpecFromGit(specPath);
    const specData = parseSpec(specPath);
    const existingProjectId = await maybeFindProjectPageId(specData);
    if (!existingProjectId) {
      await initProject(specPath);
      return;
    }
    const diffResult = await diffSync(specPath, { suppressNoChanges: true });
    await syncGitLog('last-sync', {
      suppressNoChanges: true,
      specPath,
      forceCommentTicketIds: diffResult.forceCommentTicketIds,
    });
    return;
  }
  console.error("Invalid command. Use 'init', 'sync', 'spec-update', or 'full-sync'.");
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
