
const express = require('express');
const router  = express.Router();
const fs      = require('fs').promises;
const path    = require('path');

const ROOT     = path.resolve(__dirname, '..');
const EXCLUDE  = ['node_modules', '.git', '.cache', 'uploads', 'tokens.json', '.nvm', 'attached_assets', 'reports'];
const MAX_SIZE = 1_000_000; // 1 MB

async function walk(dir) {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const dirent of dirents) {
    const abs = path.join(dir, dirent.name);
    const rel = path.relative(ROOT, abs);

    // skip unwanted folders / files
    if (EXCLUDE.some(e => rel.split(path.sep).includes(e))) continue;

    if (dirent.isDirectory()) {
      out.push(...await walk(abs));
    } else {
      try {
        const { size } = await fs.stat(abs);
        if (size > MAX_SIZE) continue;
        const content = await fs.readFile(abs, 'utf8');
        out.push({ path: rel, content });
      } catch (err) {
        // Skip files that can't be read (binary, permissions, etc.)
        continue;
      }
    }
  }
  return out;
}

router.get('/api/project-analysis', async (req, res) => {
  try {
    if (req.headers['x-analysis-token'] !== process.env.ANALYSIS_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const files = await walk(ROOT);
    res.json({ generatedAt: new Date().toISOString(), files });
  } catch (err) {
    console.error('analysis route error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
