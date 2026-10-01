import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { contactSheetPathFor } from '../../create-video/qc/contact.js';
import { manifestPathFor, reportPathsFor } from '../../create-video/qc/manifest.js';
import { summaryPathsFor } from '../../create-video/summary.js';
import { buildArgv, qcArgv } from '../lib/build-options.js';
import { outputBaseName, presetFileName } from '../lib/guards.js';
import { createLineSplitter, parseLogLine } from '../lib/log-parser.js';

const MAX_EVENTS = 5000;
const MAX_JOBS = 5;
const KILL_GRACE_MS = 5000;
const SCRIPTS = {
  build: 'scripts/create-video/index.js',
  qc: 'scripts/create-video/qc/index.js',
};
const managers = new Set();

// createVideo / qc の子プロセスを 1 本ずつ動かし、stdout/stderr を行単位のイベントにして SSE へ流す。
// detached でプロセスグループ長にするのは、execFileSync で起きた孫 ffmpeg も cancel で一緒に止めるため。
export class JobManager {
  constructor(context) {
    this.context = context;
    this.jobs = new Map();
    this.current = null;
    this.last = null;
    this.seq = 0;
    this.sigintHandler = null;
    managers.add(this);
  }

  start({ kind, name, argv, logName, script = SCRIPTS[kind] }) {
    if (this.current) {
      const error = new Error('busy');
      error.status = 409;
      error.jobId = this.current.id;
      throw error;
    }

    this.seq += 1;
    const id = `job-${Date.now().toString(36)}-${this.seq}`;
    const logDir = path.join(this.context.outputDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${logName}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    const child = spawn(process.execPath, [script, ...argv], {
      cwd: this.context.projectRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const job = {
      id,
      kind,
      name,
      argv,
      script,
      command: `node ${script} ${argv.map(quoteArg).join(' ')}`,
      logPath,
      logStream,
      child,
      state: 'running',
      cancelRequested: false,
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      events: [],
      nextEventId: 1,
      listeners: new Set(),
      lineCount: 0,
      progress: null,
      stage: null,
      outPath: null,
      concat: null,
      sidecars: [],
      qc: null,
      error: null,
    };
    this.jobs.set(id, job);
    this.trimJobs();
    this.current = job;

    const stdout = createLineSplitter((line) => this.handleLine(job, 'out', line));
    const stderr = createLineSplitter((line) => this.handleLine(job, 'err', line));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      job.error = error.message;
      this.emit(job, 'error', { message: error.message });
      this.finish(job, { code: null, signal: null });
    });
    child.on('close', (code, signal) => {
      stdout.flush();
      stderr.flush();
      this.finish(job, { code, signal });
    });
    child.unref();
    this.installSigint();
    this.emit(job, 'started', this.summary(job));
    return this.summary(job);
  }

  handleLine(job, stream, text) {
    job.lineCount += 1;
    job.logStream.write(`${text}\n`);
    this.emit(job, 'log', { n: job.lineCount, stream, text });
    const parsed = parseLogLine(text);
    if (!parsed) {
      return;
    }
    if (parsed.kind === 'progress') {
      job.progress = { i: parsed.i, n: parsed.n, base: parsed.base };
      job.stage = 'render';
      this.emit(job, 'progress', job.progress);
    } else if (parsed.kind === 'stage') {
      job.stage = parsed.name;
      this.emit(job, 'stage', { name: parsed.name });
    } else if (parsed.kind === 'done') {
      job.outPath = parsed.outPath;
    } else if (parsed.kind === 'concat') {
      job.concat = parsed.method;
    } else if (parsed.kind === 'sidecar') {
      job.sidecars.push(parsed.path);
      job.stage = parsed.stage;
      this.emit(job, 'stage', { name: parsed.stage });
    } else if (parsed.kind === 'qc') {
      job.qc = { error: parsed.error, warn: parsed.warn, info: parsed.info };
      job.stage = 'qc';
    }
  }

  finish(job, { code, signal }) {
    if (job.state !== 'running') {
      return;
    }
    job.exitCode = code;
    job.signal = signal;
    job.endedAt = Date.now();
    if (job.cancelRequested) {
      job.state = 'cancelled';
    } else if (code === 0) {
      job.state = 'done';
    } else {
      job.state = 'error';
    }
    job.logStream.end();
    const summary = this.summary(job);
    this.emit(job, 'done', summary);
    this.last = summary;
    if (this.current === job) {
      this.current = null;
    }
    this.removeSigint();
  }

  emit(job, event, data) {
    const entry = { id: job.nextEventId, event, data };
    job.nextEventId += 1;
    job.events.push(entry);
    if (job.events.length > MAX_EVENTS) {
      job.events.splice(0, job.events.length - MAX_EVENTS);
    }
    for (const listener of job.listeners) {
      listener(entry.event, entry.data, entry.id);
    }
  }

  subscribe(jobId, emit, since = 0) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    for (const entry of job.events) {
      if (entry.id > since) {
        emit(entry.event, entry.data, entry.id);
      }
    }
    if (job.state !== 'running') {
      return () => {};
    }
    job.listeners.add(emit);
    return () => {
      job.listeners.delete(emit);
    };
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (job.state !== 'running') {
      return job.state;
    }
    job.cancelRequested = true;
    killGroup(job.child, 'SIGTERM');
    const timer = setTimeout(() => {
      if (job.state === 'running') {
        killGroup(job.child, 'SIGKILL');
      }
    }, KILL_GRACE_MS);
    timer.unref();
    return 'cancelling';
  }

  shutdown() {
    if (this.current) {
      this.current.cancelRequested = true;
      killGroup(this.current.child, 'SIGTERM');
    }
    this.removeSigint();
  }

  summary(job) {
    const outBase = job.outPath ? path.basename(job.outPath, path.extname(job.outPath)) : null;
    return {
      id: job.id,
      kind: job.kind,
      name: job.name,
      state: job.state,
      command: job.command,
      argv: job.argv,
      logPath: path.relative(this.context.projectRoot, job.logPath),
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      ms: (job.endedAt ?? Date.now()) - job.startedAt,
      exitCode: job.exitCode,
      progress: job.progress,
      stage: job.stage,
      outPath: job.outPath ? path.relative(this.context.projectRoot, job.outPath) : null,
      outBase,
      concat: job.concat,
      sidecars: job.state === 'running' ? null : this.sidecarsFor(outBase),
      qc: job.qc,
      error: job.error,
    };
  }

  sidecarsFor(outBase) {
    if (!outBase) {
      return null;
    }
    const mp4 = path.join(this.context.outputDir, `${outBase}.mp4`);
    const report = reportPathsFor(mp4);
    const summary = summaryPathsFor(mp4);
    const comments = [];
    if (fs.existsSync(summary.comment)) {
      comments.push(path.basename(summary.comment));
    } else {
      for (let i = 1; i <= 99; i += 1) {
        const part = path.join(this.context.outputDir, `${outBase}.comment-${i}.txt`);
        if (!fs.existsSync(part)) {
          break;
        }
        comments.push(path.basename(part));
      }
    }
    return {
      mp4: fs.existsSync(mp4),
      render: fs.existsSync(manifestPathFor(mp4)),
      qcJson: fs.existsSync(report.json),
      qcMd: fs.existsSync(report.md),
      contact: fs.existsSync(contactSheetPathFor(mp4)),
      youtube: fs.existsSync(summary.youtube),
      meta: fs.existsSync(summary.meta),
      comments,
    };
  }

  trimJobs() {
    while (this.jobs.size > MAX_JOBS) {
      const oldest = [...this.jobs.values()].find((job) => job.state !== 'running');
      if (!oldest) {
        break;
      }
      this.jobs.delete(oldest.id);
    }
  }

  // Vite は SIGTERM と stdin end しか捕まえず、Ctrl-C（SIGINT）では httpServer.close が発火しない。
  // ジョブ実行中だけハンドラを登録し、子プロセスのグループを止めてから終了する。
  installSigint() {
    if (this.sigintHandler) {
      return;
    }
    this.sigintHandler = () => {
      this.shutdown();
      process.exit(130);
    };
    process.once('SIGINT', this.sigintHandler);
  }

  removeSigint() {
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
      this.sigintHandler = null;
    }
  }
}

export function shutdownJobs() {
  for (const manager of managers) {
    manager.shutdown();
  }
}

export function createJobRoutes(context, manager = new JobManager(context)) {
  return [
    { method: 'POST', pattern: /^\/build$/u, handler: async (req) => startBuild(context, manager, req.body) },
    { method: 'POST', pattern: /^\/qc$/u, handler: async (req) => startQc(context, manager, req.body) },
    { method: 'GET', pattern: /^\/jobs$/u, handler: async () => ({ status: 200, json: { current: manager.current ? manager.summary(manager.current) : null, last: manager.last } }) },
    { method: 'GET', pattern: /^\/jobs\/(?<id>[\w-]+)$/u, handler: async (req, params) => jobSummary(manager, params.id) },
    { method: 'GET', pattern: /^\/build\/(?<id>[\w-]+)\/log$/u, handler: async (req, params) => streamLog(manager, req, params.id) },
    { method: 'POST', pattern: /^\/build\/(?<id>[\w-]+)\/cancel$/u, handler: async (req, params) => cancelJob(manager, params.id) },
  ];
}

async function startBuild(context, manager, body) {
  try {
    if (!isPlainObject(body)) {
      throw new Error('body must be an object');
    }
    const name = presetFileName(body.name);
    if (!name) {
      throw new Error('invalid preset name');
    }
    if (!fs.existsSync(path.join(context.presetsDir, name))) {
      return { status: 404, json: { error: 'preset not found' } };
    }
    const argv = buildArgv(name, body.options || {});
    const job = manager.start({ kind: 'build', name, argv, logName: name.replace(/\.json$/u, '') });
    return { status: 200, json: { job } };
  } catch (error) {
    return errorResponse(error);
  }
}

async function startQc(context, manager, body) {
  try {
    if (!isPlainObject(body)) {
      throw new Error('body must be an object');
    }
    const name = presetFileName(body.name);
    const video = outputBaseName(body.video);
    if (!name || !video) {
      throw new Error('invalid preset or video name');
    }
    if (!fs.existsSync(path.join(context.outputDir, `${video}.mp4`))) {
      return { status: 404, json: { error: 'video not found' } };
    }
    const argv = qcArgv(name, video, { contact: body.contact === true });
    const job = manager.start({ kind: 'qc', name, argv, logName: `${name.replace(/\.json$/u, '')}.qc` });
    return { status: 200, json: { job } };
  } catch (error) {
    return errorResponse(error);
  }
}

async function jobSummary(manager, id) {
  const job = manager.jobs.get(id);
  if (!job) {
    return { status: 404, json: { error: 'job not found' } };
  }
  return { status: 200, json: { job: manager.summary(job) } };
}

async function streamLog(manager, req, id) {
  if (!manager.jobs.has(id)) {
    return { status: 404, json: { error: 'job not found' } };
  }
  const querySince = Number(req.query.get('since') || 0);
  return {
    status: 200,
    sse: {
      subscribe: (emit, headerSince) => {
        const since = Math.max(Number.isFinite(querySince) ? querySince : 0, Number.isFinite(headerSince) ? headerSince : 0);
        return manager.subscribe(id, emit, since) || (() => {});
      },
    },
  };
}

async function cancelJob(manager, id) {
  const state = manager.cancel(id);
  if (state === null) {
    return { status: 404, json: { error: 'job not found' } };
  }
  return { status: 200, json: { state } };
}

function errorResponse(error) {
  if (error?.status === 409) {
    return { status: 409, json: { error: 'busy', jobId: error.jobId } };
  }
  return { status: 400, json: { error: error instanceof Error ? error.message : String(error) } };
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // 既に終了している
    }
  }
}

function quoteArg(value) {
  return /^[\w./=-]+$/u.test(value) ? value : `'${String(value).replace(/'/gu, "'\\''")}'`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
