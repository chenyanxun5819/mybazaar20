const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectId = process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || '';
const candidates = [
  '.env',
  projectId ? `.env.${projectId}` : null,
  '.env.local'
].filter(Boolean);

for (const fileName of candidates) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) continue;

  dotenv.config({
    path: filePath,
    override: fileName !== '.env'
  });
}
