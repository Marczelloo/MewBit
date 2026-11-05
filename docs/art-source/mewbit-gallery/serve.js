// Serves the built gallery and its per-pose bundles on localhost so the browser pane can open it.
const http = require("http");
const fs = require("fs");
const path = require("path");

const page = path.join(__dirname, "animacje-mewbit.html");
http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bundle = /^\/bundles\/(\w+\.json)/.exec(req.url);
  if (bundle) {
    const file = path.join(__dirname, "bundles", bundle[1]);
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(fs.readFileSync(file));
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(fs.readFileSync(page));
}).listen(8799, "127.0.0.1");
