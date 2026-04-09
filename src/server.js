const express = require('express');
const path = require('path');
function createServer() {
  const app = express();

  // Cache parsed data per range key (reparse on demand via refresh endpoint)
  const cache = new Map();

  function friendlyError(err) {
    const msg = err.message || String(err);
    if (err.code === 'ENOENT') return { error: 'Claude Code data directory not found. Have you used Claude Code yet?', code: 'ENOENT' };
    if (err.code === 'EPERM' || err.code === 'EACCES') return { error: 'Permission denied reading Claude Code data. Try running with elevated permissions.', code: err.code };
    return { error: msg };
  }

  // Map a range token to an ISO timestamp cutoff (or null for "all")
  function rangeToSince(range) {
    const days = { '7d': 7, '30d': 30, '90d': 90 }[range];
    if (!days) return null;
    const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return d.toISOString();
  }

  // Parse a custom `since` query value (YYYY-MM-DD or full ISO). Returns an ISO
  // string cutoff, or null if the value is missing or invalid.
  function parseSinceParam(value) {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  // Resolve a cache key + ISO cutoff from the request. A custom `since` wins
  // over the preset `range` token.
  function resolveSelection(req) {
    const customSince = parseSinceParam(req.query.since);
    if (customSince) return { key: 'since:' + customSince, since: customSince };
    const range = ['7d', '30d', '90d', 'all'].includes(req.query.range) ? req.query.range : 'all';
    return { key: 'range:' + range, since: rangeToSince(range) };
  }

  app.get('/api/data', async (req, res) => {
    try {
      const { key, since } = resolveSelection(req);
      if (!cache.has(key)) {
        cache.set(key, await require('./parser').parseAllSessions({ since }));
      }
      res.json(cache.get(key));
    } catch (err) {
      res.status(500).json(friendlyError(err));
    }
  });

  app.get('/api/refresh', async (req, res) => {
    try {
      delete require.cache[require.resolve('./parser')];
      cache.clear();
      const { key, since } = resolveSelection(req);
      const data = await require('./parser').parseAllSessions({ since });
      cache.set(key, data);
      res.json({ ok: true, sessions: data.sessions.length });
    } catch (err) {
      res.status(500).json(friendlyError(err));
    }
  });

  // Serve static dashboard
  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}

module.exports = { createServer };
