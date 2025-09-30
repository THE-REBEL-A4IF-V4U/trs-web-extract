const express = require("express");
const fetch = require("node-fetch");
const archiver = require("archiver");
const cheerio = require("cheerio");
const sanitize = require("sanitize-filename");
const { URL } = require("url");
const path = require("path");

const app = express();
const PORT = 4000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function resolveUrl(base, relative) {
  try { return new URL(relative, base).href; }
  catch { return null; }
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    },
    redirect: "follow",
    timeout: 15000
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.buffer();
}

app.post("/save-proxy", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).send("Missing url");
  if (!url.startsWith("http://") && !url.startsWith("https://"))
    return res.status(400).send("URL must start with http or https");

  try {
    const pageResp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", timeout:15000 });
    if (!pageResp.ok) return res.status(502).send(`Failed to fetch page: ${pageResp.status}`);
    const html = await pageResp.text();
    const baseUrl = pageResp.url || url;

    const $ = cheerio.load(html);
    const resources = [];
    const added = new Set();

    function addIf(resUrl, folder) {
      if (!resUrl) return;
      const abs = resolveUrl(baseUrl, resUrl);
      if (!abs || added.has(abs)) return;
      added.add(abs);
      const filename = sanitize(new URL(abs).pathname.split("/").filter(Boolean).pop() || "file");
      resources.push({ abs, pathInZip: `${folder}/${filename}` });
    }

    $("img").each((i, el) => addIf($(el).attr("src"), "images"));
    $("link[rel='stylesheet']").each((i, el) => addIf($(el).attr("href"), "css"));
    $("script[src]").each((i, el) => addIf($(el).attr("src"), "js"));

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitize(new URL(baseUrl).hostname)}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    archive.append(html, { name: "index.html" });

    for (const r of resources) {
      try {
        const buf = await fetchBuffer(r.abs);
        archive.append(buf, { name: r.pathInZip });
      } catch (e) {
        console.warn("Skip resource", r.abs);
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch website: " + err.message);
  }
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
