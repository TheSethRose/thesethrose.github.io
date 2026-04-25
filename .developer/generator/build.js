import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
const generatorDir = __dirname;
const rawDir = path.join(generatorDir, "raw");
const config = JSON.parse(fs.readFileSync(path.join(generatorDir, "site.config.json"), "utf8"));
const headTemplate = fs.readFileSync(path.join(generatorDir, "head.html"), "utf8");
const navMarkdown = fs.readFileSync(path.join(generatorDir, "nav.md"), "utf8").trim();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayHrefToHtmlHref(displayHref) {
  const markdownUrlPrefix = `${config.siteUrl}/`;
  if (!displayHref.startsWith(markdownUrlPrefix) || !displayHref.endsWith(".md")) {
    return displayHref;
  }

  const slug = displayHref.slice(markdownUrlPrefix.length, -".md".length);
  const page = config.pages.find((item) => item.slug === slug);
  return page ? canonicalUrl(page) : displayHref;
}

function localDisplayHref(href) {
  if (href === `${config.siteUrl}/`) {
    return "/index.md";
  }

  const prefix = `${config.siteUrl}/`;
  if (!href.startsWith(prefix)) {
    return href;
  }

  const path = href.slice(prefix.length).replace(/\.md$/, "");
  return `/${path || "index"}.md`;
}

function renderLink(label, displayHref, options = {}) {
  const href = options.keepHref ? displayHref : displayHrefToHtmlHref(displayHref);
  const visualHref = options.displayHref || href;
  const current = options.currentPage && canonicalUrl(options.currentPage) === href
    ? ' aria-current="page"'
    : "";
  return `<a href="${escapeHtml(href)}" data-display-href="${escapeHtml(visualHref)}"${current}>${label}</a>`;
}

function inlineMarkdown(value, options = {}) {
  let html = escapeHtml(value);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, displayHref) => {
    const href = options.keepHref ? displayHref : displayHrefToHtmlHref(displayHref);
    const visualHref = options.useLocalDisplayHref ? localDisplayHref(href) : href;
    return renderLink(label, displayHref, {
      currentPage: options.currentPage,
      displayHref: visualHref,
      keepHref: options.keepHref
    });
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/&amp;middot;/g, '<span class="sep">·</span>');
  return html;
}

function renderNav(page) {
  const lines = navMarkdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p class="md-nav-line">${inlineMarkdown(line, {
      currentPage: page,
      useLocalDisplayHref: true
    })}</p>`)
  const themeToggle = '<span class="sep">·</span> <button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle color theme">theme: auto</button>';
  lines[lines.length - 1] = lines[lines.length - 1].replace("</p>", ` ${themeToggle}</p>`);

  return `<nav class="md-nav" aria-label="Primary">
${lines.join("\n")}
</nav>`;
}

function renderThemeScript() {
  return `<script>
(() => {
  const button = document.querySelector("[data-theme-toggle]");
  const root = document.documentElement;

  if (!button) return;

  const systemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const getStoredTheme = () => {
    const stored = localStorage.getItem("theme");
    return stored === "dark" || stored === "light" ? stored : "auto";
  };
  const getResolvedTheme = (theme) => theme === "auto" ? (systemPrefersDark() ? "dark" : "light") : theme;
  const applyTheme = (theme) => {
    if (theme === "auto") {
      root.removeAttribute("data-theme");
      localStorage.removeItem("theme");
    } else {
      root.dataset.theme = theme;
      localStorage.setItem("theme", theme);
    }

    const resolvedTheme = getResolvedTheme(theme);
    button.textContent = \`theme: \${theme}\`;
    button.setAttribute("aria-pressed", resolvedTheme === "dark" ? "true" : "false");
    button.setAttribute("aria-label", \`Theme is \${theme}. Activate to switch theme.\`);
  };
  const getNextTheme = (theme) => {
    if (theme === "auto") return "dark";
    if (theme === "dark") return "light";
    return "auto";
  };

  button.addEventListener("click", () => {
    applyTheme(getNextTheme(getStoredTheme()));
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getStoredTheme() === "auto") {
      applyTheme("auto");
    }
  });

  applyTheme(getStoredTheme());
})();
</script>`;
}

function splitFrontmatter(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") {
    return { frontmatterHtml: "", contentMarkdown: markdown };
  }

  const end = lines.indexOf("---", 1);
  if (end < 1) {
    return { frontmatterHtml: "", contentMarkdown: markdown };
  }

  return {
    frontmatterHtml: `<pre class="frontmatter">${escapeHtml(lines.slice(0, end + 1).join("\n"))}</pre>`,
    contentMarkdown: lines.slice(end + 1).join("\n")
  };
}

function stripCanonicalNote(markdown) {
  return markdown.replace(/\n---\n[\s\S]*?Canonical HTML:.*\n?$/, "").trimEnd() + "\n";
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let inList = false;

  function closeParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      closeParagraph();
      closeList();
      continue;
    }

    if (trimmed === "---") {
      closeParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^-\s+(.+)$/.exec(trimmed);
    if (bullet) {
      closeParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  closeParagraph();
  closeList();
  return html.join("\n");
}

function renderTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || "");
}

function canonicalUrl(page) {
  return page.path === "/" ? `${config.siteUrl}/` : `${config.siteUrl}${page.path}`;
}

function pageJsonLd(page) {
  const person = {
    "@type": "Person",
    name: config.author,
    jobTitle: "Senior Application Developer & Platform Engineer",
    url: canonicalUrl(page),
    sameAs: ["https://github.com/TheSethRose", "https://linkedin.com/in/SethLRose"],
    knowsAbout: ["ServiceNow", "AI automation", "TypeScript", "React", "Python", "Internal tools", "Developer workflows"]
  };

  if (page.slug === "index") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        { ...person, url: `${config.siteUrl}/` },
        { "@type": "WebSite", name: config.domain, url: `${config.siteUrl}/` }
      ]
    };
  }

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: person
  };
}

function renderPage(page, markdown) {
  const canonical = canonicalUrl(page);
  const { frontmatterHtml, contentMarkdown } = splitFrontmatter(markdown);
  const head = renderTemplate(headTemplate, {
    title: escapeHtml(page.title),
    description: escapeHtml(page.description || config.defaultDescription),
    ogTitle: escapeHtml(page.ogTitle || page.title),
    canonical,
    jsonLd: JSON.stringify(pageJsonLd(page), null, 2)
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
${head}
</head>
<body>
${renderNav(page)}
<main class="md-doc">
${frontmatterHtml}
<article>
${markdownToHtml(stripCanonicalNote(contentMarkdown))}
</article>
</main>
${renderThemeScript()}
</body>
</html>
`;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readRawMarkdown(page) {
  const filePath = path.join(rawDir, `${page.slug}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing raw source: .developer/generator/raw/${page.slug}.md`);
  }
  return fs.readFileSync(filePath, "utf8").trimEnd() + "\n";
}

function buildLlmsTxt() {
  const core = config.pages
    .filter((page) => ["resume", "about", "projects", "skills", "agents", "contact"].includes(page.slug))
    .map((page) => `- [${page.ogTitle.replace(/^Seth Rose /, "")}](${config.siteUrl}/${page.slug}.md): ${page.description}`)
    .join("\n");

  const htmlPages = config.pages
    .filter((page) => page.slug !== "index")
    .slice(0, 5)
    .map((page) => `- [${page.ogTitle.replace(/^Seth Rose /, "")}](${canonicalUrl(page)})`)
    .join("\n");

  return `# seth.md

${config.defaultDescription}

## Core files

${core}

## HTML pages

- [Home](${config.siteUrl}/)
${htmlPages}

## Notes

Prefer the Markdown files when ingesting content.
Prefer the HTML pages when linking from search results or browser UI.
`;
}

function buildLlmsFull() {
  const sections = config.pages
    .map((page) => {
      const label = page.slug === "index" ? "Home" : page.ogTitle.replace(/^Seth Rose /, "");
      return `## ${label}\n\n${readRawMarkdown(page).replace(/\n---\n[\s\S]*?Canonical HTML:.*\n?$/, "").trim()}`;
    })
    .join("\n\n---\n\n");

  return `# seth.md full public context

${sections}
`;
}

function buildSitemap() {
  const urls = [];
  for (const page of config.pages) {
    urls.push(canonicalUrl(page));
  }
  for (const page of config.pages) {
    urls.push(`${config.siteUrl}/${page.slug}.md`);
  }
  urls.push(`${config.siteUrl}/llms.txt`, `${config.siteUrl}/llms-full.txt`);

  const entries = urls
    .map((url) => `  <url><loc>${url}</loc><lastmod>${config.lastmod}</lastmod></url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function buildRobotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: ${config.siteUrl}/sitemap.xml

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /
`;
}

function build() {
  for (const page of config.pages) {
    const markdown = readRawMarkdown(page);
    writeFile(path.join(root, `${page.slug}.md`), markdown);
    const htmlPath = page.slug === "index"
      ? path.join(root, "index.html")
      : path.join(root, page.slug, "index.html");
    writeFile(htmlPath, renderPage(page, markdown));
  }

  writeFile(path.join(root, "llms.txt"), buildLlmsTxt());
  writeFile(path.join(root, "llms-full.txt"), buildLlmsFull());
  writeFile(path.join(root, "sitemap.xml"), buildSitemap());
  writeFile(path.join(root, "robots.txt"), buildRobotsTxt());
  writeFile(path.join(root, "CNAME"), `${config.domain}\n`);
  writeFile(path.join(root, ".nojekyll"), "");
}

build();
