const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const { createArtworkProxy, variantUrls } = require("../../helpers/activity/artworkProxy");

const allowed = (value) => /^https:\/\/(i\.ytimg\.com|cdn\.test)\//.test(value);
const image = (bytes = "jpeg-bytes", type = "image/jpeg") => new Response(bytes, { status: 200, headers: { "Content-Type": type } });
const status = (code, headers = {}) => new Response(null, { status: code, headers });

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe("artwork variants", () => {
  it("serves YouTube thumbnails at the size a list asks for", () => {
    const max = "https://i.ytimg.com/vi/abc/maxresdefault.jpg";
    assert.deepEqual(variantUrls(max, "small"), ["https://i.ytimg.com/vi/abc/mqdefault.jpg", "https://i.ytimg.com/vi/abc/hqdefault.jpg"]);
    assert.deepEqual(variantUrls(max, "medium"), ["https://i.ytimg.com/vi/abc/hqdefault.jpg"]);
    assert.deepEqual(variantUrls(max), [max, "https://i.ytimg.com/vi/abc/hqdefault.jpg"]);
    const hq = "https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=x";
    assert.deepEqual(variantUrls(hq), [hq], "no size: the url goes out as it came");
  });

  it("leaves other hosts and unknown sizes alone", () => {
    const deezer = "https://cdn-images.dzcdn.net/images/cover/id/1000x1000.jpg";
    assert.deepEqual(variantUrls(deezer, "small"), [deezer]);
    const max = "https://i.ytimg.com/vi/abc/maxresdefault.jpg";
    assert.deepEqual(variantUrls(max, "huge"), variantUrls(max));
    assert.deepEqual(variantUrls("not a url", "small"), ["not a url"]);
  });
});

describe("artwork proxy", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mewbeat-art-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const proxyOf = (fetchImpl, extra = {}) => createArtworkProxy({ dir, isAllowedUrl: allowed, fetchImpl, ...extra });

  it("fetches once and serves later requests from memory", async () => {
    const calls = [];
    const proxy = proxyOf(async (url) => { calls.push(url); return image(); });
    const first = await proxy.fetchArtwork("https://cdn.test/a.jpg");
    const second = await proxy.fetchArtwork("https://cdn.test/a.jpg");
    assert.equal(first.ok, true);
    assert.equal(first.contentType, "image/jpeg");
    assert.equal(first.body.toString(), "jpeg-bytes");
    assert.equal(second.etag, first.etag);
    assert.equal(calls.length, 1);
  });

  it("serves from disk after a restart", async () => {
    let calls = 0;
    const first = proxyOf(async () => { calls += 1; return image("kept", "image/png"); });
    await first.fetchArtwork("https://cdn.test/a.png");
    await new Promise((resolve) => setTimeout(resolve, 50)); // the disk write is not awaited by the request
    assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith(".art")).length, 1);

    const second = proxyOf(async () => { calls += 1; return image("other"); });
    const result = await second.fetchArtwork("https://cdn.test/a.png");
    assert.equal(result.body.toString(), "kept");
    assert.equal(result.contentType, "image/png");
    assert.equal(calls, 1);
  });

  it("keeps sizes apart", async () => {
    const calls = [];
    const proxy = proxyOf(async (url) => { calls.push(url); return image(url); });
    const max = "https://i.ytimg.com/vi/abc/maxresdefault.jpg";
    const small = await proxy.fetchArtwork(max, "small");
    const full = await proxy.fetchArtwork(max);
    assert.equal(small.body.toString(), "https://i.ytimg.com/vi/abc/mqdefault.jpg");
    assert.equal(full.body.toString(), max);
    assert.equal(calls.length, 2);
  });

  it("falls back to hqdefault when maxresdefault is missing", async () => {
    const calls = [];
    const proxy = proxyOf(async (url) => {
      calls.push(url);
      return url.endsWith("maxresdefault.jpg") ? status(404) : image("hq");
    });
    const result = await proxy.fetchArtwork("https://i.ytimg.com/vi/abc/maxresdefault.jpg");
    assert.equal(result.ok, true);
    assert.equal(result.body.toString(), "hq");
    assert.deepEqual(calls, ["https://i.ytimg.com/vi/abc/maxresdefault.jpg", "https://i.ytimg.com/vi/abc/hqdefault.jpg"]);
  });

  it("shares one upstream fetch between concurrent requests", async () => {
    const gate = deferred();
    let calls = 0;
    const proxy = proxyOf(async () => { calls += 1; await gate.promise; return image(); });
    const requests = [proxy.fetchArtwork("https://cdn.test/a.jpg"), proxy.fetchArtwork("https://cdn.test/a.jpg"), proxy.fetchArtwork("https://cdn.test/a.jpg")];
    gate.resolve();
    const results = await Promise.all(requests);
    assert.equal(calls, 1);
    assert.ok(results.every((result) => result.ok));
  });

  it("runs at most `concurrency` upstream fetches at once", async () => {
    let running = 0;
    let peak = 0;
    const gate = deferred();
    const proxy = proxyOf(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
      return image();
    }, { concurrency: 3 });
    const requests = Array.from({ length: 10 }, (_, index) => proxy.fetchArtwork(`https://cdn.test/${index}.jpg`));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(running, 3);
    gate.resolve();
    const results = await Promise.all(requests);
    assert.ok(results.every((result) => result.ok));
    assert.equal(peak, 3);
  });

  describe("failures", () => {
    it("remembers a definitive failure for 30 s, then asks again", async () => {
      let clock = 1_000;
      let calls = 0;
      const proxy = proxyOf(async () => { calls += 1; return status(404); }, { now: () => clock });
      const first = await proxy.fetchArtwork("https://cdn.test/gone.jpg");
      assert.deepEqual(first, { ok: false, definitive: true });
      await proxy.fetchArtwork("https://cdn.test/gone.jpg");
      assert.equal(calls, 1);
      clock += 29_000;
      await proxy.fetchArtwork("https://cdn.test/gone.jpg");
      assert.equal(calls, 1);
      clock += 2_000;
      await proxy.fetchArtwork("https://cdn.test/gone.jpg");
      assert.equal(calls, 2);
    });

    it("never remembers a timeout, a network error or a server error", async () => {
      for (const failure of [
        async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); },
        async () => { throw new TypeError("fetch failed"); },
        async () => status(503),
      ]) {
        let calls = 0;
        const proxy = proxyOf(async () => { calls += 1; return failure(); });
        assert.deepEqual(await proxy.fetchArtwork("https://cdn.test/x.jpg"), { ok: false, definitive: false });
        assert.deepEqual(await proxy.fetchArtwork("https://cdn.test/x.jpg"), { ok: false, definitive: false });
        assert.equal(calls, 2, "asked again");
      }
    });

    it("treats a non-image answer and an oversized image as definitive", async () => {
      const proxy = proxyOf(async (url) => (url.includes("html") ? image("<html>", "text/html") : image("x".repeat(100))), { maxImageBytes: 50 });
      assert.deepEqual(await proxy.fetchArtwork("https://cdn.test/html.jpg"), { ok: false, definitive: true });
      assert.deepEqual(await proxy.fetchArtwork("https://cdn.test/big.jpg"), { ok: false, definitive: true });
    });

    it("recovers once a transient failure is over", async () => {
      let broken = true;
      const proxy = proxyOf(async () => { if (broken) throw new TypeError("fetch failed"); return image(); });
      assert.equal((await proxy.fetchArtwork("https://cdn.test/a.jpg")).ok, false);
      broken = false;
      assert.equal((await proxy.fetchArtwork("https://cdn.test/a.jpg")).ok, true);
    });
  });

  it("follows redirects inside the allowed hosts and refuses one that leaves them", async () => {
    const proxy = proxyOf(async (url) => {
      if (url === "https://cdn.test/old.jpg") return status(302, { location: "https://cdn.test/new.jpg" });
      if (url === "https://cdn.test/out.jpg") return status(302, { location: "https://evil.example/x.jpg" });
      return image("moved");
    });
    assert.equal((await proxy.fetchArtwork("https://cdn.test/old.jpg")).body.toString(), "moved");
    await assert.rejects(proxy.fetchArtwork("https://cdn.test/out.jpg"), (error) => error.statusCode === 400);
  });

  it("keeps the disk cache under its cap, oldest out", async () => {
    const proxy = proxyOf(async (url) => image(`${"x".repeat(1000)}${url}`), { diskMaxBytes: 3500 });
    for (let index = 0; index < 6; index += 1) {
      await proxy.fetchArtwork(`https://cdn.test/${index}.jpg`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // The disk writes and the eviction run behind the replies, and under a loaded test run they can still be going:
    // a file listed can be gone before its size is read. Look until the cache has settled under its cap.
    const sizeOf = (name) => {
      try {
        return fs.statSync(path.join(dir, name)).size;
      } catch (error) {
        if (error.code === "ENOENT") return 0;
        throw error;
      }
    };
    let files = [];
    let total = Infinity;
    for (let tries = 0; tries < 100; tries += 1) {
      files = fs.readdirSync(dir).filter((name) => name.endsWith(".art"));
      total = files.reduce((sum, name) => sum + sizeOf(name), 0);
      if (total <= 3500 && files.length >= 1 && files.length < 6) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(total <= 3500, `disk holds ${total} bytes`);
    assert.ok(files.length >= 1 && files.length < 6);
  });
});
