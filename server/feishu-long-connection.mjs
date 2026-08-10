import { FEISHU_RECEIVE_MESSAGE_EVENT } from './feishu-events.mjs';
import {
  handleFeishuReceiveMessage,
  listEnabledFeishuTriggerCandidates,
} from './feishu-trigger-handler.mjs';

async function loadFeishuSdk() {
  try {
    return await import('@larksuiteoapi/node-sdk');
  } catch (err) {
    throw new Error(
      'FEISHU_EVENT_MODE=long_connection requires @larksuiteoapi/node-sdk. Run `pnpm install` or `pnpm add @larksuiteoapi/node-sdk`.',
      { cause: err }
    );
  }
}

function buildReceiveMessagePayload(event, appId) {
  return {
    schema: '2.0',
    header: {
      event_id: event?.event_id ?? event?.eventId ?? '',
      event_type: FEISHU_RECEIVE_MESSAGE_EVENT,
      create_time: event?.create_time ?? event?.createTime ?? '',
      tenant_key: event?.tenant_key ?? event?.tenantKey ?? '',
      app_id: event?.app_id ?? event?.appId ?? appId ?? '',
    },
    event,
  };
}

export function createFeishuLongConnection({
  appId,
  appSecret,
  db,
  enqueueSavedWorkflowRun,
  fetchImpl = fetch,
  logger = console,
  sdk,
}) {
  if (!appId || !appSecret) {
    throw new Error('FEISHU_EVENT_APP_ID and FEISHU_EVENT_APP_SECRET are required');
  }
  if (!sdk) {
    throw new Error('Feishu long connection SDK is required');
  }

  const loggerLevel = sdk.LoggerLevel?.info ?? sdk.LoggerLevel?.debug;
  // #302: enable the SDK's pong watchdog — without wsConfig.pingTimeout the
  // watchdog is a no-op (pingTimeoutSec = 0), so a silently-dead connection
  // (e.g. NAT mapping expired, TCP still ESTAB) is never detected and events
  // stop arriving forever. With a 30s watchdog (< 120s ping interval) a ping
  // with no pong terminates the socket and triggers the standard reconnect.
  const wsClient = new sdk.WSClient({
    appId,
    appSecret,
    loggerLevel,
    wsConfig: { pingTimeout: 30 },
  });
  const eventDispatcher = new sdk.EventDispatcher({}).register({
    [FEISHU_RECEIVE_MESSAGE_EVENT]: async (event) => {
      try {
        const result = await handleFeishuReceiveMessage({
          db,
          enqueueSavedWorkflowRun,
          payload: buildReceiveMessagePayload(event, appId),
          appId,
          fetchImpl,
        });
        logger.info?.('[feishu] receive-message handled', result);
      } catch (err) {
        logger.error?.('[feishu] receive-message failed', err);
      }
    },
  });

  let started = false;
  return {
    start() {
      if (started) return;
      started = true;
      wsClient.start({ eventDispatcher });
      logger.info?.('[feishu] long connection started');
    },
    close() {
      if (!started) return;
      started = false;
      if (typeof wsClient.close === 'function') wsClient.close();
      else if (typeof wsClient.stop === 'function') wsClient.stop();
      logger.info?.('[feishu] long connection stopped');
    },
  };
}

function appConnectionKey({ appId, appSecret }) {
  return `${appId}\u0000${appSecret}`;
}

function listDesiredApps(db) {
  const apps = new Map();
  for (const candidate of listEnabledFeishuTriggerCandidates(db)) {
    const key = appConnectionKey(candidate);
    if (!apps.has(key)) {
      apps.set(key, { appId: candidate.appId, appSecret: candidate.appSecret });
    }
  }
  return apps;
}

export function createFeishuLongConnectionManager({
  db,
  enqueueSavedWorkflowRun,
  fetchImpl = fetch,
  logger = console,
  sdk,
}) {
  const connections = new Map();
  let sdkPromise = null;

  async function getSdk() {
    if (sdk) return sdk;
    sdkPromise ??= loadFeishuSdk();
    return sdkPromise;
  }

  async function refresh() {
    const desired = listDesiredApps(db);

    for (const [key, connection] of connections) {
      if (!desired.has(key)) {
        connection.close();
        connections.delete(key);
      }
    }

    if (desired.size === 0) {
      logger.info?.('[feishu] no enabled trigger with app credentials; long connection idle');
      return;
    }

    const loadedSdk = await getSdk();
    for (const [key, app] of desired) {
      if (connections.has(key)) continue;
      const connection = createFeishuLongConnection({
        ...app,
        db,
        enqueueSavedWorkflowRun,
        fetchImpl,
        logger,
        sdk: loadedSdk,
      });
      connection.start();
      connections.set(key, connection);
    }
    logger.info?.('[feishu] long connection manager refreshed', {
      activeConnections: connections.size,
    });
  }

  function close() {
    for (const connection of connections.values()) connection.close();
    connections.clear();
  }

  return {
    refresh,
    close,
    get activeConnectionCount() {
      return connections.size;
    },
  };
}

export async function maybeStartFeishuLongConnectionManager(options) {
  const eventMode = process.env.FEISHU_EVENT_MODE ?? 'long_connection';
  if (eventMode !== 'long_connection') return null;

  const manager = createFeishuLongConnectionManager(options);
  await manager.refresh();
  return manager;
}

export const maybeStartFeishuLongConnection = maybeStartFeishuLongConnectionManager;
