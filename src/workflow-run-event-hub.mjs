/**
 * Page-level SSE connection manager for saved Workflow Runs.
 *
 * The hub owns one EventSource for the page. Consumers subscribe with a
 * workflow/run/type filter and receive already-parsed event payloads. Native
 * EventSource reconnection is retained; every reconnect receives REST snapshot
 * reconciliation and the server's init snapshots. The hub rejects stale
 * progress/status events before local fan-out.
 */

// #297: BASE_PATH is injected at build time via rsbuild source.define (empty
// for root-path builds, e.g. '/workflow' for the sub-path nginx mount).
const BASE_PATH = process.env.BASE_PATH ?? '';

const DEFAULT_EVENTS_URL = ({ workflowIds, runIDs, types }) => {
  const params = new URLSearchParams();
  for (const workflowId of workflowIds) params.append('workflowId', workflowId);
  for (const runID of runIDs) params.append('runID', runID);
  for (const type of types) params.append('type', type);
  const query = params.toString();
  return `${BASE_PATH}/api/runs/events${query ? `?${query}` : ''}`;
};

const DEFAULT_SNAPSHOT_URL = (workflowId) =>
  `${BASE_PATH}/api/workflows/${encodeURIComponent(workflowId)}/runs`;

const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'canceled',
  'terminated',
  'timed_out',
  'timeout',
]);

const TERMINAL_ROW_FIELDS = ['task_id', 'queued_at', 'started_at', 'ended_at'];

const STATUS_ORDER = new Map([
  ['queued', 0],
  ['running', 1],
  ['cancelling', 2],
  ['canceling', 2],
  ['succeeded', 3],
  ['failed', 3],
  ['cancelled', 3],
  ['canceled', 3],
  ['terminated', 3],
  ['timed_out', 3],
  ['timeout', 3],
]);

function createDefaultEventSource(url) {
  if (typeof EventSource !== 'function') {
    throw new Error('EventSource is unavailable outside a browser');
  }
  return new EventSource(url);
}

async function fetchDefaultSnapshot(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function parseEvent(data) {
  if (typeof data !== 'string') return null;
  try {
    const payload = JSON.parse(data);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function normalizeRevision(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) return { kind: 'number', value: numeric };
  return { kind: 'string', value: String(value) };
}

function compareRevision(left, right) {
  if (!left || !right) return null;
  if (left.kind === 'number' && right.kind === 'number') {
    return left.value === right.value ? 0 : left.value < right.value ? -1 : 1;
  }
  if (left.kind === 'string' && right.kind === 'string') {
    return left.value === right.value ? 0 : left.value < right.value ? -1 : 1;
  }
  return null;
}

function eventRevision(payload, message) {
  return normalizeRevision(
    payload.sequence ?? payload.seq ?? payload.version ?? message?.lastEventId
  );
}

function statusOrder(status) {
  return STATUS_ORDER.get(status) ?? 1;
}

function isTerminalStatus(status) {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status);
}

function terminalRow(runID, payload) {
  const row = { id: runID, status: payload.status };
  for (const field of TERMINAL_ROW_FIELDS) {
    if (payload[field] !== undefined) row[field] = payload[field];
  }
  return row;
}

function reportState(report) {
  const state = new Map();
  for (const [nodeID, nodeReport] of Object.entries(report?.reports ?? {})) {
    if (!nodeReport || typeof nodeReport !== 'object') continue;
    state.set(nodeID, {
      status: nodeReport.status,
      snapshotLength: Array.isArray(nodeReport.snapshots) ? nodeReport.snapshots.length : 0,
    });
  }
  return state;
}

function acceptReport(progressState, runID, report) {
  const incoming = reportState(report);
  const previous = progressState.get(runID);
  if (!previous) {
    progressState.set(runID, incoming);
    return true;
  }

  let changed = false;
  for (const [nodeID, next] of incoming) {
    const prev = previous.get(nodeID);
    if (prev && next.snapshotLength < prev.snapshotLength) return false;
    if (!prev || prev.status !== next.status || prev.snapshotLength !== next.snapshotLength) {
      changed = true;
    }
  }
  if (!changed) return false;

  for (const [nodeID, next] of incoming) previous.set(nodeID, next);
  return true;
}

/**
 * @typedef {object} WorkflowRunEventSubscription
 * @property {string} [runID]
 * @property {Iterable<string>} [types]
 * @property {(event: object) => void} onEvent
 * @property {(error: Event) => void} [onError]
 */

export class WorkflowRunEventHub {
  /**
   * @param {object} [options]
   * @param {(url: string) => EventSource} [options.createEventSource]
   * @param {(filter: {workflowIds: string[], runIDs: string[], types: string[]}) => string} [options.eventsUrl]
   * @param {(workflowId: string) => string} [options.snapshotUrl]
   * @param {(workflowId: string) => Promise<object[]>} [options.fetchSnapshot]
   */
  constructor({
    createEventSource = createDefaultEventSource,
    eventsUrl = DEFAULT_EVENTS_URL,
    snapshotUrl = DEFAULT_SNAPSHOT_URL,
    fetchSnapshot = (workflowId) => fetchDefaultSnapshot(snapshotUrl(workflowId)),
  } = {}) {
    this.createEventSource = createEventSource;
    this.eventsUrl = eventsUrl;
    this.fetchSnapshot = fetchSnapshot;
    /** @type {Set<object>} */
    this.subscribers = new Set();
    /** @type {object|null} */
    this.connection = null;
  }

  /**
   * @param {Array<{workflowId: string, subscription: WorkflowRunEventSubscription}>} entries
   * @returns {() => void}
   */
  subscribeMany(entries) {
    if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
    if (entries.length === 0) return () => {};

    const records = entries.map(({ workflowId, subscription }) => {
      if (!workflowId) throw new TypeError('workflowId is required');
      if (!subscription || typeof subscription.onEvent !== 'function') {
        throw new TypeError('subscription.onEvent is required');
      }
      const types = subscription.types ? new Set(subscription.types) : null;
      return {
        workflowId,
        runID: subscription.runID,
        types: types?.size ? types : null,
        onEvent: subscription.onEvent,
        onError: subscription.onError,
      };
    });

    for (const record of records) this.subscribers.add(record);
    this.syncConnection();
    if (this.connection) this.replayCurrentState(this.connection, records);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const record of records) this.subscribers.delete(record);
      this.syncConnection();
    };
  }

  /**
   * @param {string} workflowId
   * @param {WorkflowRunEventSubscription} subscription
   * @returns {() => void}
   */
  subscribe(workflowId, subscription) {
    return this.subscribeMany([{ workflowId, subscription }]);
  }

  /** @param {string} workflowId */
  connectionCount(workflowId) {
    if (!this.connection || this.connection.closed) return 0;
    if (workflowId !== undefined) {
      return this.connection.workflowIds.has(workflowId) ? 1 : 0;
    }
    return 1;
  }

  /** @param {string} workflowId */
  subscriberCount(workflowId) {
    let count = 0;
    for (const subscriber of this.subscribers) {
      if (subscriber.workflowId === workflowId) count += 1;
    }
    return count;
  }

  /** Close the page-level connection and remove all subscriptions. */
  close() {
    this.subscribers.clear();
    if (this.connection) this.closeConnection(this.connection);
  }

  getConnectionFilter() {
    if (this.subscribers.size === 0) return null;

    const workflowIds = [...new Set([...this.subscribers].map((item) => item.workflowId))].sort();
    const runIDs = [...this.subscribers].some((item) => !item.runID)
      ? []
      : [...new Set([...this.subscribers].map((item) => item.runID))].sort();
    const types = [...this.subscribers].some((item) => !item.types)
      ? []
      : [...new Set([...this.subscribers].flatMap((item) => [...item.types]))].sort();
    return { workflowIds, runIDs, types };
  }

  syncConnection() {
    const filter = this.getConnectionFilter();
    if (!filter) {
      if (this.connection) this.closeConnection(this.connection);
      return;
    }

    const filterKey = JSON.stringify(filter);
    if (this.connection && !this.connection.closed && this.connection.filterKey === filterKey) {
      return;
    }
    if (this.connection) this.closeConnection(this.connection);
    this.connection = this.openConnection(filter, filterKey);
  }

  /**
   * @param {{workflowIds: string[], runIDs: string[], types: string[]}} filter
   * @param {string} filterKey
   */
  openConnection(filter, filterKey) {
    const connection = {
      workflowIds: new Set(filter.workflowIds),
      filterKey,
      source: null,
      terminalRuns: new Set(),
      terminalEvents: new Set(),
      terminalSnapshots: new Map(),
      runStatuses: new Map(),
      runRevisions: new Map(),
      progressRevisions: new Map(),
      progressState: new Map(),
      activeRuns: new Map(),
      initializedWorkflows: new Set(),
      snapshotPromise: null,
      closed: false,
    };
    const source = this.createEventSource(this.eventsUrl(filter));
    connection.source = source;
    source.onmessage = (message) => {
      this.handleMessage(connection, message);
    };
    source.onerror = (error) => {
      for (const subscription of [...this.subscribers]) {
        if (!connection.workflowIds.has(subscription.workflowId)) continue;
        subscription.onError?.(error);
      }
      this.reconcileSnapshot(connection);
    };
    this.reconcileSnapshot(connection);
    return connection;
  }

  /** @param {object} connection */
  reconcileSnapshot(connection) {
    if (connection.closed || connection.snapshotPromise) return;
    const workflowIds = [...connection.workflowIds];
    const snapshotPromise = Promise.all(
      workflowIds.map((workflowId) =>
        Promise.resolve(this.fetchSnapshot(workflowId))
          .then((runs) => {
            if (connection.closed || !connection.workflowIds.has(workflowId)) return;
            if (!Array.isArray(runs)) return;
            const reconciledRuns = runs.map((run) =>
              this.reconcileSnapshotRun(connection, workflowId, run)
            );
            this.dispatch(connection, { type: 'snapshot', workflowId, runs: reconciledRuns });
          })
          .catch(() => {
            // The stream may be the only surviving transport while the network is down.
          })
      )
    ).finally(() => {
      if (connection.snapshotPromise === snapshotPromise) connection.snapshotPromise = null;
    });
    connection.snapshotPromise = snapshotPromise;
  }

  /**
   * Apply a REST row to the connection's monotonic run state. A response that
   * started before a terminal event must not make a terminal run look active.
   */
  reconcileSnapshotRun(connection, workflowId, run) {
    const runID = run?.id ?? run?.runID;
    if (typeof runID !== 'string') return run;
    const runKey = `${workflowId}:${runID}`;
    const knownTerminal = connection.terminalSnapshots.get(runKey);
    const previousStatus = connection.runStatuses.get(runKey);
    if (previousStatus && statusOrder(run.status) < statusOrder(previousStatus)) {
      return { ...run, status: previousStatus };
    }
    if (connection.terminalRuns.has(runKey)) {
      return knownTerminal
        ? { ...run, ...knownTerminal }
        : { ...run, status: connection.runStatuses.get(runKey) };
    }

    connection.runStatuses.set(runKey, run.status);
    if (!isTerminalStatus(run.status)) return run;

    connection.terminalRuns.add(runKey);
    connection.terminalSnapshots.set(runKey, terminalRow(runID, run));
    connection.activeRuns.delete(runKey);
    return run;
  }

  /**
   * @param {object} connection
   * @param {string} workflowId
   * @param {object} payload
   * @param {object|null} revision
   */
  reconcileInitPayload(connection, workflowId, payload, revision) {
    connection.initializedWorkflows.add(workflowId);
    const activeRunKeys = new Set();
    const activeRuns = Array.isArray(payload.activeRuns)
      ? payload.activeRuns.flatMap((activeRun) => {
          const runID = activeRun?.runID;
          if (typeof runID !== 'string') return [];
          const runKey = `${workflowId}:${runID}`;
          if (connection.terminalRuns.has(runKey)) return [];

          const previousRun = connection.activeRuns.get(runKey);
          const previousRevision = connection.progressRevisions.get(runKey);
          const revisionComparison = compareRevision(revision, previousRevision);
          if (previousRun && revisionComparison !== null && revisionComparison <= 0) {
            activeRunKeys.add(runKey);
            return [previousRun];
          }

          const previousStatus = connection.runStatuses.get(runKey);
          const status =
            previousStatus && statusOrder(activeRun.status) < statusOrder(previousStatus)
              ? previousStatus
              : activeRun.status;
          connection.runStatuses.set(runKey, status);
          if (isTerminalStatus(status)) {
            connection.terminalRuns.add(runKey);
            connection.terminalSnapshots.set(runKey, terminalRow(runID, { ...activeRun, status }));
            connection.activeRuns.delete(runKey);
            return [];
          }
          let report = activeRun.report ?? previousRun?.report ?? null;
          if (activeRun.report) {
            const accepted = acceptReport(connection.progressState, runKey, activeRun.report);
            if (!accepted && previousRun?.report) report = previousRun.report;
          }
          activeRunKeys.add(runKey);
          const normalizedRun = { ...activeRun, status, report };
          connection.activeRuns.set(runKey, normalizedRun);
          if (revision) connection.progressRevisions.set(runKey, revision);
          return [normalizedRun];
        })
      : payload.activeRuns;
    const activeRunIDs = Array.isArray(payload.activeRunIDs)
      ? payload.activeRunIDs.filter(
          (runID) =>
            typeof runID === 'string' && !connection.terminalRuns.has(`${workflowId}:${runID}`)
        )
      : payload.activeRunIDs;
    for (const runKey of connection.activeRuns.keys()) {
      if (runKey.startsWith(`${workflowId}:`) && !activeRunKeys.has(runKey)) {
        connection.activeRuns.delete(runKey);
      }
    }
    for (const runID of Array.isArray(activeRunIDs) ? activeRunIDs : []) {
      const runKey = `${workflowId}:${runID}`;
      if (!connection.activeRuns.has(runKey) && !connection.terminalRuns.has(runKey)) {
        connection.activeRuns.set(runKey, {
          runID,
          status: connection.runStatuses.get(runKey),
          report: null,
        });
      }
    }
    return { ...payload, activeRuns, activeRunIDs };
  }

  /**
   * @param {object} connection
   * @param {{data: string, lastEventId?: string}} message
   */
  handleMessage(connection, message) {
    if (connection.closed) return;
    let payload = parseEvent(message.data);
    if (!payload || typeof payload.type !== 'string') return;

    const { type, runID, status } = payload;
    const workflowId =
      payload.workflowId ??
      (connection.workflowIds.size === 1 ? [...connection.workflowIds][0] : null);
    if (!workflowId || !connection.workflowIds.has(workflowId)) return;
    const revision = eventRevision(payload, message);
    if (type === 'init') {
      payload = this.reconcileInitPayload(connection, workflowId, payload, revision);
    }
    const runKey = runID ? `${workflowId}:${runID}` : null;
    if (runKey && revision) {
      const previousRevision = connection.runRevisions.get(runKey);
      const comparison = compareRevision(revision, previousRevision);
      if (comparison !== null && comparison <= 0) return;
      connection.runRevisions.set(runKey, revision);
    }

    if (type === 'run_progress') {
      if (!runKey || connection.terminalRuns.has(runKey)) return;
      if (revision) {
        const previous = connection.progressRevisions.get(runKey);
        const comparison = compareRevision(revision, previous);
        if (comparison !== null && comparison <= 0) return;
        connection.progressRevisions.set(runKey, revision);
      } else if (!acceptReport(connection.progressState, runKey, payload.report)) {
        return;
      }
      const activeRun = connection.activeRuns.get(runKey);
      connection.activeRuns.set(runKey, {
        ...activeRun,
        runID,
        status: connection.runStatuses.get(runKey),
        report: payload.report,
      });
    }

    if (type === 'run_status' && runID) {
      if (connection.terminalRuns.has(runKey) && !isTerminalStatus(status)) return;
      const previousStatus = connection.runStatuses.get(runKey);
      if (!revision && previousStatus && statusOrder(status) < statusOrder(previousStatus)) {
        return;
      }
      connection.runStatuses.set(runKey, status);
      if (isTerminalStatus(status)) {
        connection.terminalRuns.add(runKey);
        connection.terminalSnapshots.set(runKey, {
          ...connection.terminalSnapshots.get(runKey),
          ...terminalRow(runID, payload),
        });
        connection.activeRuns.delete(runKey);
      } else {
        const activeRun = connection.activeRuns.get(runKey);
        connection.activeRuns.set(runKey, {
          ...activeRun,
          runID,
          status,
          report: activeRun?.report ?? null,
        });
      }
    }

    if (type === 'run_terminal' && runID) {
      if (connection.terminalEvents.has(runKey)) return;
      connection.terminalEvents.add(runKey);
      connection.terminalRuns.add(runKey);
      connection.runStatuses.set(runKey, status);
      connection.terminalSnapshots.set(runKey, {
        ...connection.terminalSnapshots.get(runKey),
        ...terminalRow(runID, payload),
      });
      connection.activeRuns.delete(runKey);
    }

    this.dispatch(connection, payload);
    if (type === 'workflow_deleted') {
      for (const subscriber of [...this.subscribers]) {
        if (subscriber.workflowId === workflowId) this.subscribers.delete(subscriber);
      }
      for (const runKey of connection.activeRuns.keys()) {
        if (runKey.startsWith(`${workflowId}:`)) connection.activeRuns.delete(runKey);
      }
      this.syncConnection();
    }
  }

  /** @param {object} connection @param {Array<object>} records */
  replayCurrentState(connection, records) {
    for (const record of records) {
      const workflowPrefix = `${record.workflowId}:`;
      const activeRuns = [...connection.activeRuns.entries()]
        .filter(([runKey]) => runKey.startsWith(workflowPrefix))
        .map(([, run]) => ({ ...run }));
      const terminalRuns = [...connection.terminalSnapshots.entries()].filter(([runKey]) =>
        runKey.startsWith(workflowPrefix)
      );
      if (
        !connection.initializedWorkflows.has(record.workflowId) &&
        activeRuns.length === 0 &&
        terminalRuns.length === 0
      ) {
        continue;
      }

      if (!record.types || record.types.has('init')) {
        record.onEvent({
          type: 'init',
          workflowId: record.workflowId,
          activeRunIDs: activeRuns.map((run) => run.runID),
          activeRuns,
        });
      }

      if (!record.types || record.types.has('run_terminal')) {
        for (const [runKey, snapshot] of terminalRuns) {
          const runID = snapshot.id ?? runKey.slice(workflowPrefix.length);
          if (record.runID && record.runID !== runID) continue;
          const { id, ...terminal } = snapshot;
          record.onEvent({
            type: 'run_terminal',
            workflowId: record.workflowId,
            runID,
            ...terminal,
          });
        }
      }
    }
  }

  /**
   * @param {object} connection
   * @param {object} payload
   */
  dispatch(connection, payload) {
    const workflowId =
      payload.workflowId ??
      (connection.workflowIds.size === 1 ? [...connection.workflowIds][0] : null);
    if (!workflowId) return;
    for (const subscription of [...this.subscribers]) {
      if (subscription.workflowId !== workflowId) continue;
      if (subscription.types && !subscription.types.has(payload.type)) continue;
      if (subscription.runID && payload.runID && subscription.runID !== payload.runID) continue;
      subscription.onEvent(payload);
    }
  }

  /** @param {object} connection */
  closeConnection(connection) {
    if (connection.closed) return;
    connection.closed = true;
    connection.source.onmessage = null;
    connection.source.onerror = null;
    try {
      connection.source.close();
    } finally {
      if (this.connection === connection) this.connection = null;
    }
  }
}

export const workflowRunEventHub = new WorkflowRunEventHub();

export { isTerminalStatus };
