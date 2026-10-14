// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the AircraftApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// (and TZ, the time zone of Gladys, read by the app for the active hours).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { AircraftApp } from './src/app.js';
import { ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new AircraftApp({ gladys });

// --- Discovery -------------------------------------------------------------------
gladys.onScanRequest(() => app.scan());
gladys.onDeviceCreated((device) => app.deviceChanged(device));
gladys.onDeviceUpdated((device) => app.deviceChanged(device));
gladys.onDeviceDeleted((device) => app.deviceChanged(device));

// --- Scene action ---------------------------------------------------------------
gladys.onSceneAction(SCENE_ACTIONS.GET_AIRCRAFT, (fields) => app.getAircraft(fields));

// --- Dashboard widget -----------------------------------------------------------
gladys.onWidgetGet(WIDGETS.SKY, (request) => app.getWidget(request));

// --- Configuration screen button ------------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config, { saved: true });
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => app.stop());
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Aircraft overhead integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
