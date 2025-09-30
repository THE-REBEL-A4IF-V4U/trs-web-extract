const express = require("express");
const fetch = require("node-fetch"); // v2
const archiver = require("archiver");
const cheerio = require("cheerio");
const sanitize = require("sanitize-filename");
const { URL } = require("url");

const app = express();
app.use(express.json());
app.use(express.static("public")); // serve frontend if needed

function resolveUrl(base, relative) {
  try { return new URL(relative, base).href; }
  catch { return null; }
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": "SaveWeb2Zip/1.0" } });
  if (!res.ok) throw new Error(res.status + " " + res.statusText);
  return await res.buffer();
}

app.post("/save-proxy", async (req, res) => {
  const { url } = req.body;

  if (!url || !url.startsWith("http")) 
    return res.status(400).send("Invalid URL. Must start with http or https");

  try {
    const pageResp = await fetch(url);
    if (!pageResp.ok) return res.status(500).send("Failed to fetch page: " + pageResp.status);
    const html = await pageResp.text();
    const baseUrl = pageResp.url;

    const $ = cheerio.load(html);
    const resources = [];
    const added = new Set();

    function addIf(resUrl, folder) {
      if (!resUrl) return;
      const abs = resolveUrl(baseUrl, resUrl);
      if (!abs || added.has(abs)) return;
      added.add(abs);
      const filename = sanitize(new URL(abs).pathname.split("/").filter(Boolean).pop() || "file");
      const pathInZip = `${folder}/${filename}`;
      resources.push({ abs, pathInZip });
    }

    $("img").each((i, el) => addIf($(el).attr("src"), "images"));
    $("link[rel=stylesheet]").each((i, el) => addIf($(el).attr("href"), "css"));
    $("script[src]").each((i, el) => addIf($(el).attr("src"), "js"));

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="page.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    archive.append(html, { name: "index.html" });

    for (const r of resources) {
      try {
        const buf = await fetchBuffer(r.abs);
        archive.append(buf, { name: r.pathInZip });
      } catch (e) {
        console.warn("Skip resource:", r.abs, e.message);
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Server error: " + err.message);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}/save-proxy`));
