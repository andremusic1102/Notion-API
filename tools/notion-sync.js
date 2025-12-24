#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const {
  defaultSpecPath,
  loadSpecFile,
  writeSpecFile,
  computePriority,
  normalizeTicketNumber,
  nextStatusForSync,
  maxLastSynced,
} = require('./notion-rules');

const NOTION_TOKEN = 'ntn_b86750914948HHTVYnnygGdDMwvD6YlJxuiVw5TqmyWe47';

const PROJECTS_DB_ID = 'f5124c3d-1b2c-47da-87af-9d062d01fde7';
const TICKETS_DB_ID = '6574df08-bf7c-4813-906f-5f3f3f819908';
const NOTION_VERSION = '2022-06-28';

function resolveSpecPath(specArg, projectRoot) {
  if (specArg) {
    return path.isAbsolute(specArg) ? specArg : path.resolve(projectRoot, specArg);
  }
  return defaultSpecPath(projectRoot);
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

function notionRequest(url, payload, method = 'POST') {
  const body = payload ? JSON.stringify(payload) : '';
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

async function queryDatabase(databaseId, payload) {
  return notionRequest(`https://api.notion.com/v1/databases/${databaseId}/query`, payload, 'POST');
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

function runGitCommand(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', cwd: options.cwd });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function currentBranchName(projectRoot) {
  try {
    return runGitCommand(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: projectRoot }).trim();
  } catch (error) {
    return null;
  }
}

function parseGitLog(projectRoot, sinceValue) {
  const format = '%H%x1F%an%x1F%s%x1F%cI%x1F%d%x1E';
  const output = runGitCommand(
    ['log', `--since=${sinceValue}`, `--pretty=format:${format}`, '--decorate=short'],
    { cwd: projectRoot }
  ).trim();
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

function getBranchesContainingCommit(projectRoot, commitHash) {
  try {
    const output = runGitCommand(['branch', '--contains', commitHash], { cwd: projectRoot });
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

function determineBranch(projectRoot, commit, fallbackBranch) {
  const fromDecor = extractBranchFromDecorations(commit.decoration);
  if (fromDecor) {
    return fromDecor;
  }
  const branches = getBranchesContainingCommit(projectRoot, commit.hash);
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

function groupCommitsByBranch(projectRoot, commits, fallbackBranch) {
  const grouped = new Map();
  const ordered = [...commits].reverse();
  for (const commit of ordered) {
    const branch = determineBranch(projectRoot, commit, fallbackBranch);
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

function shortHash(hash) {
  if (!hash) {
    return '';
  }
  return hash.slice(0, 7);
}

function commitsAfterLatest(commits, latestCommit) {
  if (!latestCommit) {
    return commits;
  }
  const index = commits.findIndex((commit) => shortHash(commit.hash) === latestCommit);
  if (index === -1) {
    return commits;
  }
  return commits.slice(index + 1);
}

async function findProjectPage(specData) {
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
  const page = result.results && result.results.length > 0 ? result.results[0] : null;
  if (!page) {
    throw new Error('Project not found in Notion');
  }
  return page;
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

async function updatePageProperties(pageId, properties) {
  if (!pageId || !properties || Object.keys(properties).length === 0) {
    return null;
  }
  return notionPatch(`https://api.notion.com/v1/pages/${pageId}`, { properties });
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

function buildTicketUpdatesFromSpec(specTicket, existingProps) {
  const updates = {};
  if (specTicket.Title && specTicket.Title !== getTitleValue(existingProps, 'Title')) {
    updates.Title = buildTitle(specTicket.Title);
  }
  if (specTicket['Dev Notes'] && specTicket['Dev Notes'] !== getRichTextValue(existingProps, 'Dev Notes')) {
    updates['Dev Notes'] = buildRichText(specTicket['Dev Notes']);
  }
  if (specTicket.Branch && specTicket.Branch !== getRichTextValue(existingProps, 'Branch')) {
    updates.Branch = buildRichText(specTicket.Branch);
  }
  if (specTicket.Priority && specTicket.Priority !== getSelectName(existingProps, 'Priority')) {
    updates.Priority = buildSelect(specTicket.Priority);
  }
  if (specTicket.Status && specTicket.Status !== getSelectName(existingProps, 'Status')) {
    updates.Status = buildSelect(specTicket.Status);
  }
  if (specTicket.Type && specTicket.Type !== getSelectName(existingProps, 'Type')) {
    updates.Type = buildSelect(specTicket.Type);
  }
  if (specTicket['Last Synced'] && specTicket['Last Synced'] !== getDateValue(existingProps, 'Last Synced')) {
    updates['Last Synced'] = buildDate(specTicket['Last Synced']);
  }
  if (specTicket['Latest Commit'] && specTicket['Latest Commit'] !== getRichTextValue(existingProps, 'Latest Commit')) {
    updates['Latest Commit'] = buildRichText(specTicket['Latest Commit']);
  }
  return updates;
}

function buildProjectUpdatesFromSpec(specProject, existingProps) {
  const updates = {};
  if (specProject['Project Key'] && specProject['Project Key'] !== getTitleValue(existingProps, 'Project Key')) {
    updates['Project Key'] = buildTitle(specProject['Project Key']);
  }
  if (specProject['Project Name'] && specProject['Project Name'] !== getRichTextValue(existingProps, 'Project Name')) {
    updates['Project Name'] = buildRichText(specProject['Project Name']);
  }
  if (specProject.Repository && specProject.Repository !== getRichTextValue(existingProps, 'Repository')) {
    updates.Repository = buildRichText(specProject.Repository);
  }
  if (specProject['Default Branch'] && specProject['Default Branch'] !== getRichTextValue(existingProps, 'Default Branch')) {
    updates['Default Branch'] = buildRichText(specProject['Default Branch']);
  }
  if (specProject.Status && specProject.Status !== getSelectName(existingProps, 'Status')) {
    updates.Status = buildSelect(specProject.Status);
  }
  if (specProject.Description && specProject.Description !== getRichTextValue(existingProps, 'Description')) {
    updates.Description = buildRichText(specProject.Description);
  }
  return updates;
}

function autoCommitIfNeeded(projectRoot) {
  const branch = currentBranchName(projectRoot);
  if (branch === 'main') {
    console.error('Refusing to auto-commit on main branch. Switch to a work branch.');
    process.exit(1);
  }

  const status = runGitCommand(['status', '--porcelain'], { cwd: projectRoot });
  if (!status.trim()) {
    return { committed: false, failed: false };
  }

  runGitCommand(['add', '-u'], { cwd: projectRoot });
  const scope = branch ? branch.split('/').slice(1).join('/') || branch : 'sync';
  const message = `chore(${scope}): sync work session updates`;
  try {
    runGitCommand(['commit', '-m', message], { cwd: projectRoot });
  } catch (error) {
    console.error(error.message || error);
    return { committed: false, failed: true };
  }

  const hash = runGitCommand(['rev-parse', '--short', 'HEAD'], { cwd: projectRoot }).trim();
  if (hash) {
    console.log(hash);
  }
  return { committed: true, failed: false, hash };
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
  console.error('Usage: node notion-sync.js sync [--spec <path-to-spec>]');
}

async function syncProject(specPath, projectRoot) {
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }

  const specData = loadSpecFile(specPath);
  if (!specData.project || (!specData.project['Project Key'] && !specData.project['Project Name'])) {
    throw new Error('Project Key or Project Name is required in the spec');
  }

  const projectPage = await findProjectPage(specData);
  const projectPageId = projectPage.id;

  const projectUpdates = buildProjectUpdatesFromSpec(specData.project, projectPage.properties);

  const existingTickets = await fetchTicketsByProject(projectPageId);
  const existingByNumber = new Map();
  for (const ticket of existingTickets) {
    const number = getNumberValue(ticket.properties, 'Ticket Number');
    if (number !== null && number !== undefined) {
      existingByNumber.set(number, ticket);
    }
  }

  const baseline = maxLastSynced(specData) || 'midnight';
  const commits = parseGitLog(projectRoot, baseline);
  const fallbackBranch = currentBranchName(projectRoot);
  const groupedCommits = groupCommitsByBranch(projectRoot, commits, fallbackBranch);
  const today = new Date().toISOString().slice(0, 10);

  const seenNumbers = new Set();
  const commentQueue = [];
  const ticketUpdates = [];
  let specChanged = false;

  for (const ticketSpec of specData.tickets || []) {
    const rawNumber = ticketSpec['Ticket Number'];
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

    const branch = ticketSpec.Branch;
    const branchCommits = branch ? groupedCommits.get(branch) || [] : [];
    const latestCommit = ticketSpec['Latest Commit'];
    const commitsToComment = commitsAfterLatest(branchCommits, latestCommit);
    const hasNewCommits = commitsToComment.length > 0;

    const currentStatus = ticketSpec.Status || 'Backlog';
    const nextStatus = nextStatusForSync(currentStatus, ticketSpec['Dev Notes'], hasNewCommits);
    if (nextStatus && nextStatus !== ticketSpec.Status) {
      ticketSpec.Status = nextStatus;
      specChanged = true;
    }

    if (branch) {
      const computedPriority = computePriority(branch, ticketSpec.Type || 'Feature');
      if (computedPriority && ticketSpec.Priority !== computedPriority) {
        ticketSpec.Priority = computedPriority;
        specChanged = true;
      }
    }

    if (hasNewCommits) {
      const latest = shortHash(branchCommits[branchCommits.length - 1].hash);
      if (latest && latest !== ticketSpec['Latest Commit']) {
        ticketSpec['Latest Commit'] = latest;
        specChanged = true;
      }
      if (ticketSpec['Last Synced'] !== today) {
        ticketSpec['Last Synced'] = today;
        specChanged = true;
      }
    }

    const existing = existingByNumber.get(number);
    if (!existing) {
      console.log(`Ticket ${number} not found in Notion. Skipping updates.`);
      continue;
    }

    if (commitsToComment.length > 0) {
      commentQueue.push({ pageId: existing.id, commits: commitsToComment, number });
    }

    const updates = buildTicketUpdatesFromSpec(ticketSpec, existing.properties);
    if (Object.keys(updates).length > 0) {
      ticketUpdates.push({ pageId: existing.id, updates, number });
    }
  }

  if (specChanged) {
    writeSpecFile(specPath, specData);
  }

  if (Object.keys(projectUpdates).length > 0) {
    await updatePageProperties(projectPageId, projectUpdates);
  }

  for (const entry of ticketUpdates) {
    await updatePageProperties(entry.pageId, entry.updates);
    console.log(`Updated ticket ${entry.number}`);
  }

  for (const entry of commentQueue) {
    for (const commit of entry.commits) {
      await postCommitComment(entry.pageId, commit);
      console.log(`Appended commit ${shortHash(commit.hash)} to ticket ${entry.number}`);
    }
  }

  if (ticketUpdates.length === 0 && commentQueue.length === 0) {
    console.log('No changes');
  }
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (command !== 'sync') {
    showUsage();
    return;
  }
  const projectRoot = process.cwd();
  const options = parseArgs(rest);
  const specPath = resolveSpecPath(options.spec, projectRoot);

  const autoCommitResult = autoCommitIfNeeded(projectRoot);
  if (autoCommitResult.failed) {
    return;
  }

  await syncProject(specPath, projectRoot);
}

main().catch((error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
