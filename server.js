const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 10000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.apk': 'application/vnd.android.package-archive',
};

// ---------------------------------------------------------------------------
// Aim geometry (identical to the client in public/index.html)
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unit = (dx, dy) => {
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};
const deg = (rad) => (rad * 180) / Math.PI;
const round = (n) => Math.round(n * 100) / 100;

function pockets(w, h) {
  return [
    { x: 0, y: 0, name: 'កំពូល-ឆ្វេង' },
    { x: w / 2, y: 0, name: 'កំពូល-កណ្តាល' },
    { x: w, y: 0, name: 'កំពូល-ស្តាំ' },
    { x: 0, y: h, name: 'ក្រោម-ឆ្វេង' },
    { x: w / 2, y: h, name: 'ក្រោម-កណ្តាល' },
    { x: w, y: h, name: 'ក្រោម-ស្តាំ' },
  ];
}

function aimCalc({ cue, target, w, h, pocketIndex, bank }) {
  const R = Math.max(12, Math.round(w * 0.0285));
  const list = pockets(w, h);
  const u = unit(target.x - cue.x, target.y - cue.y);
  const ghost = { x: target.x - u.x * 2 * R, y: target.y - u.y * 2 * R };
  const diag = Math.hypot(w, h);

  const mirror = (p) =>
    target.y <= h / 2 ? { x: p.x, y: -p.y, name: p.name } : { x: p.x, y: 2 * h - p.y, name: p.name };

  const evaluate = (p) => {
    const t = bank ? mirror(p) : p;
    const v = unit(t.x - target.x, t.y - target.y);
    const cut = deg(Math.acos(clamp(u.x * v.x + u.y * v.y, -1, 1)));
    const dist = Math.hypot(t.x - target.x, t.y - target.y);
    return { pocket: p, target: t, cut, dist, score: clamp(u.x * v.x + u.y * v.y, -1, 1) - 0.2 * (dist / diag) };
  };

  let chosen = null;
  if (Number.isInteger(pocketIndex) && pocketIndex >= 0 && pocketIndex < list.length) {
    chosen = evaluate(list[pocketIndex]);
  } else {
    for (const p of list) {
      const e = evaluate(p);
      if (e.cut > 80) continue;
      if (!chosen || e.score > chosen.score) chosen = e;
    }
  }
  if (!chosen) return null;

  const d1 = Math.hypot(ghost.x - cue.x, ghost.y - cue.y);
  const powerPct = Math.round(Math.min(100, Math.max(22, 24 + d1 * 0.055 + chosen.dist * 0.045)));

  return {
    status: 'success',
    startX: round(cue.x),
    startY: round(cue.y),
    endX: round(ghost.x),
    endY: round(ghost.y),
    cue: { x: round(cue.x), y: round(cue.y) },
    object: { x: round(target.x), y: round(target.y) },
    ghost: { x: round(ghost.x), y: round(ghost.y) },
    aimAngleDeg: round(deg(Math.atan2(ghost.y - cue.y, ghost.x - cue.x))),
    cutAngleDeg: round(chosen.cut),
    powerPct,
    pocket: { x: chosen.pocket.x, y: chosen.pocket.y, name: chosen.pocket.name, index: list.indexOf(chosen.pocket) },
    path: { target: { x: round(chosen.target.x), y: round(chosen.target.y) } },
    bank: !!bank,
    ballRadius: R,
    table: { w, h },
  };
}

const DOCS = {
  status: 'ok',
  endpoint: 'POST /api/aim',
  body: { cue: { x: 200, y: 900 }, target: { x: 380, y: 700 }, table: { w: 560, h: 1120 }, pocketIndex: -1, bank: false },
  returns: ['startX', 'startY', 'endX', 'endY', 'aimAngleDeg', 'cutAngleDeg', 'powerPct', 'pocket', 'ghost'],
  note: 'Coordinates are table units. startX/startY = cue ball, endX/endY = ghost ball (contact point).',
};

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
}

function json(res, code, payload) {
  cors(res);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

async function handleAim(req, res, head) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'GET' || head) return json(res, 200, DOCS);
  if (req.method !== 'POST') return json(res, 405, { status: 'error', message: 'Use POST' });

  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return json(res, 400, { status: 'error', message: 'Invalid JSON body' });
  }

  const cue = body.cue;
  const target = body.target || body.object;
  const table = body.table || {};
  const w = isNum(table.w) ? table.w : 560;
  const h = isNum(table.h) ? table.h : 1120;

  if (!cue || !isNum(cue.x) || !isNum(cue.y)) return json(res, 400, { status: 'error', message: 'cue must be {x, y} numbers' });
  if (!target || !isNum(target.x) || !isNum(target.y)) return json(res, 400, { status: 'error', message: 'target must be {x, y} numbers' });
  if (w < 200 || h < 200 || w > 4000 || h > 4000) return json(res, 400, { status: 'error', message: 'table must be 200..4000' });

  const inTable = (p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  if (!inTable(cue) || !inTable(target)) return json(res, 400, { status: 'error', message: 'coordinates outside table' });
  if (Math.hypot(target.x - cue.x, target.y - cue.y) < 2) {
    return json(res, 400, { status: 'error', message: 'cue and object ball are at the same spot' });
  }

  const result = aimCalc({
    cue,
    target,
    w,
    h,
    pocketIndex: body.pocketIndex === undefined || body.pocketIndex === null ? -1 : Number(body.pocketIndex),
    bank: !!body.bank,
  });

  if (!result) return json(res, 422, { status: 'error', message: 'No pottable pocket for this angle (cut > 80°)' });
  return json(res, 200, result);
}

http
  .createServer((req, res) => {
    const head = req.method === 'HEAD';
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Bad request');
    }

    if (pathname === '/api/aim' || pathname === '/api/calculate') {
      return handleAim(req, res, head).catch(() => json(res, 500, { status: 'error', message: 'Server error' }));
    }
    if (pathname === '/api' || pathname === '/api/docs') {
      return json(res, 200, DOCS);
    }
    if (pathname === '/api/health') {
      return json(res, 200, { status: 'ok', service: 'billiards-aim-trainer', uptime: Math.round(process.uptime()) });
    }

    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(head ? undefined : 'ok');
    }

    let rel = pathname.replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(head ? undefined : 'Not found');
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(head ? undefined : data);
    });
  })
  .listen(PORT, '0.0.0.0', () => console.log('listening on 0.0.0.0:' + PORT));
