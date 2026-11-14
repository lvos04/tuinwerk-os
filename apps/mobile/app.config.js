// EAS file environment variables materialize only on the build worker.
// The Firebase client configuration is bundled into Android; signing keys are not.
const fs = require("node:fs");
module.exports = ({ config }) => {
  const googleServicesFile = process.env.TUINWERK_GOOGLE_SERVICES_FILE;
  if (!googleServicesFile) return config;
  if (!fs.existsSync(googleServicesFile))
    throw new Error("Configured Android Firebase client file is missing");
  return { ...config, android: { ...config.android, googleServicesFile } };
};
