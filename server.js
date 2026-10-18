'use strict';
require('dotenv').config();
const { createApp } = require('./src/app');
const { env } = require('./src/config/env');
const { logger } = require('./src/utilities/logger');

const app = createApp();
if (require.main === module) {
  const server = app.listen(env.port, env.host, () => logger.info('server_started', { host: env.host, port: env.port }));
  require('./src/services/student-import-job-service').resumeUnfinished().catch(error => logger.error('import_job_resume_failed', { error: error.message }));
  const shutdown = signal => { logger.info('server_stopping', { signal }); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
module.exports = app;
