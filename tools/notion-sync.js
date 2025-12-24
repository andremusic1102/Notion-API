#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

// internal / local use
const NOTION_TOKEN = "ntn_b86750914948HHTVYnnygGdDMwvD6YlJxuiVw5TqmyWe47";

const PROJECTS_DB_ID = 'f5124c3d-1b2c-47da-87af-9d062d01fde7';
const TICKETS_DB_ID = '6574df08-bf7c-4813-906f-5f3f3f819908';
const NOTION_VERSION = '2022-06-28';
const NOTION_TIMEOUT_MS = 30000;

function resolveSpecPath(specArg) {
  if (!specArg) {
    throw new Error('Missing --spec argument');
  }
  return path.isAbsolute(specArg) ? specArg : path.resolve(process.cwd(), specArg);
}

function resolveDefaultSpecPath(repoRoot) {
  if (!repoRoot) {
    return null;
  }
  const candidates = [
    path.join(repoRoot, 'specs', 'notion-init.md'),
    path.join(repoRoot, 'docs', 'notion-init.md'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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
    req.setTimeout(NOTION_TIMEOUT_MS, () => {
      req.destroy(new Error('Notion API request timed out'));
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function notionGet(url) {
  const parsedUrl = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
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
    req.setTimeout(NOTION_TIMEOUT_MS, () => {
      req.destroy(new Error('Notion API request timed out'));
    });
    req.on('error', (err) => reject(err));
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

let cachedRepoRoot = null;

function resolveRepoRoot() {
  if (cachedRepoRoot !== null) {
    return cachedRepoRoot;
  }
  const candidates = [process.cwd(), path.resolve(__dirname, '..')];
  for (const candidate of candidates) {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      cwd: candidate,
    });
    if (result.status === 0) {
      cachedRepoRoot = result.stdout.trim();
      return cachedRepoRoot;
    }
  }
  cachedRepoRoot = null;
  return null;
}

function repoNameFromRoot(repoRoot) {
  return repoRoot ? path.basename(repoRoot) : null;
}

function allowedBranchPrefixes(repoRoot) {
  const repoName = repoNameFromRoot(repoRoot);
  if (repoName === 'Notion-API') {
    return ['chore/', 'techdebt/'];
  }
  return ['feature/', 'techdebt/', 'chore/'];
}

function isAllowedBranch(branch, prefixes) {
  if (!branch) {
    return false;
  }
  return prefixes.some((prefix) => branch.startsWith(prefix));
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

async function updateSpecFromGit() {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    throw new Error('Unable to resolve git repo root');
  }
  const specPath = resolveDefaultSpecPath(repoRoot);
  if (!specPath || !fs.existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath || 'unknown'}`);
  }
  const specData = parseSpec(specPath);
  const existingBranches = new Set(
    (specData.tickets || []).map((ticket) => ticket.Branch).filter(Boolean)
  );
  const existingNumbers = (specData.tickets || [])
    .map((ticket) => Number(ticket['Ticket Number']))
    .filter((value) => !Number.isNaN(value));
  const nextNumberStart = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 2001;

  const commits = parseGitLog('midnight');
  const fallbackBranch = currentBranchName();
  const groupedCommits = groupCommitsByBranch(commits, fallbackBranch);
  const candidateBranches = new Set();
  const statusBranch = getStatusBranch();
  if (statusBranch) {
    candidateBranches.add(statusBranch);
  }
  for (const branch of groupedCommits.keys()) {
    if (branch) {
      candidateBranches.add(branch);
    }
  }

  const newTickets = [];
  let ticketNumber = nextNumberStart;
  const projectName = specData.project['Project Name'];
  const projectDescription = specData.project.Description;

  const prefixes = allowedBranchPrefixes(repoRoot);
  const sortedBranches = Array.from(candidateBranches).sort();
  for (const branch of sortedBranches) {
    if (!branch || existingBranches.has(branch)) {
      continue;
    }
    if (!isAllowedBranch(branch, prefixes)) {
      continue;
    }
    const branchCommits = groupedCommits.get(branch) || [];
    const title = titleFromBranch(branch);
    const devNotes = buildDevNotes(projectName, projectDescription, branch, branchCommits);
    const type = branch.startsWith('techdebt/') ? 'Tech Debt' : 'Feature';
    const priority = branch.startsWith('techdebt/') ? 'Low' : 'Medium';
    newTickets.push({
      Title: title,
      'Ticket Number': ticketNumber,
      Priority: priority,
      Status: 'Backlog',
      Type: type,
      Branch: branch,
      'Dev Notes': devNotes,
    });
    existingBranches.add(branch);
    ticketNumber += 1;
  }

  const appendedCount = await appendTicketsToSpec(specPath, newTickets);
  for (const ticket of newTickets) {
    console.log(`Appended spec ticket ${ticket['Ticket Number']} (${ticket.Branch})`);
  }
  return { appendedCount, specPath, groupedCommits };
}

function runGitCommand(args, options = {}) {
  const repoRoot = options.cwd || resolveRepoRoot();
  const result = spawnSync('git', args, { encoding: 'utf8', cwd: repoRoot || process.cwd() });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function normalizeSince(value) {
  if (!value || value === 'today') {
    return 'midnight';
  }
  return value;
}

async function getLastSyncBaseline() {
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.log('No Last Synced found, falling back to today');
    return 'midnight';
  }
  const specPath = resolveDefaultSpecPath(repoRoot);
  if (!specPath || !fs.existsSync(specPath)) {
    console.log('No Last Synced found, falling back to today');
    return 'midnight';
  }
  const specData = parseSpec(specPath);
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
  return fallbackBranch || null;
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

function getCommentText(comment) {
  if (!comment || !Array.isArray(comment.rich_text)) {
    return '';
  }
  return comment.rich_text.map((item) => item.plain_text || '').join('');
}

async function fetchTicketComments(pageId) {
  const comments = [];
  let cursor = null;
  while (true) {
    const params = new URLSearchParams({ block_id: pageId, page_size: '100' });
    if (cursor) {
      params.set('start_cursor', cursor);
    }
    const result = await notionGet(`https://api.notion.com/v1/comments?${params.toString()}`);
    if (Array.isArray(result.results)) {
      comments.push(...result.results);
    }
    if (!result.has_more) {
      break;
    }
    cursor = result.next_cursor;
  }
  return comments;
}

function collectCommentHashes(comments) {
  const hashes = new Set();
  for (const comment of comments) {
    const text = getCommentText(comment);
    if (!text) {
      continue;
    }
    const matches = text.match(/\b[0-9a-f]{7,40}\b/gi) || [];
    for (const match of matches) {
      hashes.add(match.toLowerCase());
    }
  }
  return hashes;
}

async function syncGitLog(sinceValue, options = {}) {
  let normalizedSince = normalizeSince(sinceValue);
  if (sinceValue === 'last-sync') {
    normalizedSince = await getLastSyncBaseline();
  }
  const commits = parseGitLog(normalizedSince);
  if (!commits.length) {
    if (!options.suppressNoChanges) {
      console.log('No changes');
    }
    return { changes: 0 };
  }
  const ticketCache = {};
  const grouped = groupCommitsByBranch(commits);
  const nowIso = new Date().toISOString();
  let changes = 0;
  const repoRoot = resolveRepoRoot();
  const prefixes = allowedBranchPrefixes(repoRoot);
  const specPath = resolveDefaultSpecPath(repoRoot);
  if (!specPath || !fs.existsSync(specPath)) {
    console.warn('No spec file found for mapping branches. Skipping sync.');
    return { changes: 0 };
  }
  const specData = parseSpec(specPath);
  const specTickets = Array.isArray(specData.tickets) ? specData.tickets : [];
  const specBranches = new Set(specTickets.map((ticket) => ticket.Branch).filter(Boolean));
  const specByBranch = new Map(
    specTickets
      .filter((ticket) => ticket.Branch)
      .map((ticket) => [ticket.Branch, ticket])
  );

  for (const [branch, branchCommits] of grouped.entries()) {
    if (!branch) {
      for (const commit of branchCommits) {
        console.log(`Skipping commit ${commit.hash} - branch could not be determined`);
      }
      continue;
    }
    if (!isAllowedBranch(branch, prefixes)) {
      console.log(`Skipping branch ${branch} - unsupported prefix`);
      continue;
    }
    if (!specBranches.has(branch)) {
      console.warn(`No matching ticket for branch ${branch}`);
      continue;
    }
    try {
      const ticket = await findTicketForBranch(branch, ticketCache);
      if (!ticket) {
        console.warn(`No matching ticket for branch ${branch}`);
        continue;
      }
      const properties = ticket.properties || {};
      const ticketNumber = getNumberValue(properties, 'Ticket Number');
      const latestCommit = getRichTextValue(properties, 'Latest Commit');
      const statusName = getSelectName(properties, 'Status');

      const forced = options.forceCommentTicketIds && options.forceCommentTicketIds.has(ticket.id);
      const shouldSkipUntilFound =
        !forced &&
        latestCommit &&
        branchCommits.some((commit) => shortHash(commit.hash) === latestCommit);
      let startAppending = !shouldSkipUntilFound;
      let appendedAny = false;
      let newestCommit = null;

      const existingComments = await fetchTicketComments(ticket.id);
      const commentHashes = collectCommentHashes(existingComments);

      for (const commit of branchCommits) {
        const commitShort = shortHash(commit.hash);
        const commitFull = commit.hash ? commit.hash.toLowerCase() : '';
        if (!startAppending) {
          if (commitShort === latestCommit) {
            startAppending = true;
          }
          continue;
        }
        if (commentHashes.has(commitShort.toLowerCase()) || (commitFull && commentHashes.has(commitFull))) {
          console.log(`Commit already synced to this ticket: ${commitShort}`);
          continue;
        }
        await postCommitComment(ticket.id, commit);
        const ticketLabel = ticketNumber ? `${ticketNumber}` : ticket.id;
        console.log(`Appended commit ${commitShort} (${branch}) to ticket ${ticketLabel}`);
        appendedAny = true;
        newestCommit = commitShort;
        commentHashes.add(commitShort.toLowerCase());
        if (commitFull) {
          commentHashes.add(commitFull);
        }
        changes += 1;
      }

      const propertyUpdates = {};
      if (appendedAny && newestCommit && newestCommit !== latestCommit) {
        propertyUpdates['Latest Commit'] = buildRichText(newestCommit);
      }
      if (appendedAny) {
        propertyUpdates['Last Synced'] = buildDate(nowIso);
      }
      const specTicket = specByBranch.get(branch);
      const desiredStatus = specTicket && specTicket.Status ? specTicket.Status : null;
      if (desiredStatus && desiredStatus !== statusName) {
        propertyUpdates.Status = buildSelect(desiredStatus);
      } else if (shouldAdvanceStatus(statusName, appendedAny)) {
        propertyUpdates.Status = buildSelect('In Progress');
      }
      if (Object.keys(propertyUpdates).length > 0) {
        await updatePageProperties(ticket.id, propertyUpdates);
        const ticketLabel = ticketNumber ? `${ticketNumber}` : ticket.id;
        console.log(`Updated ticket ${ticketLabel}`);
        changes += 1;
      }
    } catch (error) {
      console.warn(`Warning: ${error.message || error}`);
      continue;
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
  const fallbackBranch = currentBranchName();
  const groupedCommits = groupCommitsByBranch(commits, fallbackBranch);
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

    const branch = ticketSpec.Branch;
    const hasCommits = branch && groupedCommits.has(branch) && groupedCommits.get(branch).length > 0;
    const existing = existingByNumber.get(number);
    const branchCommits = branch ? groupedCommits.get(branch) || [] : [];
    const latestCommit = branchCommits.length > 0 ? shortHash(branchCommits[branchCommits.length - 1].hash) : null;

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
    const currentBranch = getRichTextValue(existing.properties, 'Branch');
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
    if (ticketSpec.Branch && ticketSpec.Branch !== currentBranch) {
      updates.Branch = buildRichText(ticketSpec.Branch);
      updatedFields.push('Branch');
    }
    if (ticketSpec.Priority && ticketSpec.Priority !== currentPriority) {
      updates.Priority = buildSelect(ticketSpec.Priority);
      updatedFields.push('Priority');
    }
    if (ticketSpec.Type && ticketSpec.Type !== currentType) {
      updates.Type = buildSelect(ticketSpec.Type);
      updatedFields.push('Type');
    }
    if (ticketSpec.Status && ticketSpec.Status !== statusName) {
      updates.Status = buildSelect(ticketSpec.Status);
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

async function syncDaily() {
  const invalidSince = process.argv.includes('--since');
  if (invalidSince) {
    console.error("Invalid command. Use 'init' for new projects or 'sync' for daily updates.");
    return;
  }
  const repoRoot = resolveRepoRoot();
  const specPath = resolveDefaultSpecPath(repoRoot);
  let diffResult = { changes: 0, forceCommentTicketIds: new Set() };
  if (specPath && fs.existsSync(specPath)) {
    diffResult = await diffSync(specPath, { suppressNoChanges: true });
  }
  const result = await syncGitLog('last-sync', {
    suppressNoChanges: true,
    forceCommentTicketIds: diffResult.forceCommentTicketIds,
  });
  const totalChanges = (diffResult.changes || 0) + (result.changes || 0);
  if (totalChanges === 0) {
    console.log('No changes today');
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
  console.error(
    "Usage: node notion-sync.js init --spec <path> | node notion-sync.js sync"
  );
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command) {
    showUsage();
    return;
  }
  const options = parseArgs(rest);
  if (command === 'init') {
    const specPath = resolveSpecPath(options.spec);
    await initProject(specPath);
    return;
  }
  if (command === 'sync') {
    await syncDaily();
    return;
  }
  console.error("Invalid command. Use 'init' for new projects or 'sync' for daily updates.");
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
