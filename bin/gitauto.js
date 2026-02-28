#!/usr/bin/env node
"use strict";

const { spawnSync, execFileSync } = require("child_process");
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const readline = require("readline");

// ---------------------------------------------------------------------------
// Version & constants
// ---------------------------------------------------------------------------
const VERSION    = "1.0.0";
const CONFIG_DIR  = path.join(os.homedir(), ".gtxr");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const WELCOME_MARKER = path.join(CONFIG_DIR, ".welcomed");
const AI_MODULES_DIR = path.join(CONFIG_DIR, "node_modules");

const PROVIDERS = ["openai", "anthropic", "gemini"];

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[91m",
  green:  "\x1b[92m",
  yellow: "\x1b[93m",
  cyan:   "\x1b[96m",
  purple: "\x1b[95m",
};

const ok   = (msg) => console.log(`${C.green}✓ ${msg}${C.reset}`);
const info = (msg) => console.log(`${C.cyan}ℹ ${msg}${C.reset}`);
const warn = (msg) => console.log(`${C.yellow}⚠ ${msg}${C.reset}`);
const err  = (msg) => console.log(`${C.red}✗ ${msg}${C.reset}`);

function header(text) {
  const bar = "═".repeat(34);
  console.log(`\n${C.purple}${C.bold}  ╔${bar}╗${C.reset}`);
  console.log(`${C.purple}${C.bold}  ║ ${text.padEnd(33)}║${C.reset}`);
  console.log(`${C.purple}${C.bold}  ╚${bar}╝${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// Readline helper — prompts
// ---------------------------------------------------------------------------
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE))
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (_) {}
  return {};
}

function saveConfig(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------
function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return {
    ok:     r.status === 0,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function isGitRepo()       { return git("rev-parse", "--git-dir").ok; }
function getStatus()       { const r = git("status", "--short"); return r.ok ? r.stdout : ""; }
function getCurrentBranch(){ const r = git("branch", "--show-current"); return r.ok ? r.stdout : "main"; }
function getRemoteUrl()    { const r = git("remote", "get-url", "origin"); return r.ok ? r.stdout : "No remote configured"; }

function getDiff() {
  const staged = git("diff", "--cached");
  if (staged.ok && staged.stdout) return staged.stdout;
  const unstaged = git("diff");
  return unstaged.ok ? unstaged.stdout : "";
}

// ---------------------------------------------------------------------------
// AI library — lazy install into ~/.gitauto/node_modules
// ---------------------------------------------------------------------------
const AI_PACKAGES = {
  openai:    "openai",
  anthropic: "@anthropic-ai/sdk",
  gemini:    "@google/genai",
};

function ensureAiPackage(provider) {
  const pkg = AI_PACKAGES[provider];
  const pkgPath = path.join(AI_MODULES_DIR, pkg.replace("/", path.sep));

  if (fs.existsSync(pkgPath)) return; // already installed

  info(`Installing ${pkg}...`);
  fs.mkdirSync(AI_MODULES_DIR, { recursive: true });

  const r = spawnSync(
    "npm", ["install", "--prefix", CONFIG_DIR, "--no-save", "--loglevel", "error", pkg],
    { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] }
  );

  if (r.status !== 0) {
    throw new Error(`Failed to install ${pkg}:\n${r.stderr}`);
  }
}

function requireAi(provider) {
  const pkg = AI_PACKAGES[provider];
  // Add CONFIG_DIR node_modules to resolution path
  const Module = require("module");
  const origPaths = Module._nodeModulePaths;
  Module._nodeModulePaths = function(from) {
    return [AI_MODULES_DIR, ...origPaths.call(this, from)];
  };
  try {
    return require(path.join(AI_MODULES_DIR, pkg, "index.js"));
  } catch(_) {
    // fallback to standard require with modified path
    require.resolve.paths = () => [AI_MODULES_DIR];
    return require(pkg);
  } finally {
    Module._nodeModulePaths = origPaths;
  }
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------
async function callAI(provider, apiKey, prompt) {
  ensureAiPackage(provider);

  if (provider === "openai") {
    const { OpenAI } = require(path.join(AI_MODULES_DIR, "openai"));
    const client = new OpenAI({ apiKey });
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 60,
    });
    return res.choices[0].message.content.trim();
  }

  if (provider === "anthropic") {
    const Anthropic = require(path.join(AI_MODULES_DIR, "@anthropic-ai", "sdk"));
    const client = new (Anthropic.default || Anthropic)({ apiKey });
    const msg = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });
    return msg.content[0].text.trim();
  }

  if (provider === "gemini") {
    const { GoogleGenAI } = require(path.join(AI_MODULES_DIR, "@google", "genai"));
    const ai  = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return res.text.trim();
  }

  throw new Error(`Unknown provider: ${provider}`);
}

function handleAiError(provider, error) {
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("credit") || msg.includes("quota") || msg.includes("insufficient")) {
    err("AI API credits exhausted.");
    if (provider === "anthropic") info("Billing: https://console.anthropic.com/settings/billing");
    if (provider === "openai")    info("Billing: https://platform.openai.com/account/billing");
    info("Or skip AI with: gtxr --no-ai");
  } else if (msg.includes("invalid") || msg.includes("auth") || msg.includes("401")) {
    err("Invalid API key. Reconfigure with: gtxr setup");
  } else if (msg.includes("rate") || msg.includes("429")) {
    err("Rate limit hit. Wait a moment and retry, or use: gtxr --no-ai");
  } else {
    err(`AI generation failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Push logic
// ---------------------------------------------------------------------------
function push(branch, forcePush) {
  if (forcePush) {
    warn("Force pushing — this overwrites remote history.");
    const r = git("push", "--force", "origin", branch);
    if (r.ok) { ok(`Force-pushed to origin/${branch}`); return true; }
    err(`Force push failed: ${r.stderr}`); return false;
  }

  info(`Pushing to origin/${branch}...`);
  let r = git("push", "origin", branch);
  if (r.ok) { ok(`Pushed to origin/${branch}`); return true; }

  // No upstream
  if (r.stderr.includes("no upstream") || r.stderr.includes("has no upstream")) {
    info("New branch — setting upstream automatically...");
    r = git("push", "--set-upstream", "origin", branch);
    if (r.ok) { ok(`Pushed and upstream set for origin/${branch}`); return true; }
    err(`Failed to set upstream: ${r.stderr}`); return false;
  }

  // Rejected — auto rebase
  const rejected = ["fetch first", "non-fast-forward", "rejected"]
    .some(k => r.stderr.toLowerCase().includes(k));

  if (rejected) {
    info("Remote has new commits — rebasing automatically...");
    const rebase = git("pull", "--rebase", "origin", branch);
    if (!rebase.ok) {
      err("Auto-rebase failed — conflicts need manual resolution.");
      info("Your repo is in rebase state. To resolve:");
      info("  1. Open conflicted files and fix the markers");
      info("  2. git add .");
      info("  3. git rebase --continue");
      info(`  4. git push origin ${branch}`);
      info("  Or to cancel: git rebase --abort");
      return false;
    }
    r = git("push", "origin", branch);
    if (r.ok) { ok(`Pushed to origin/${branch} after rebase.`); return true; }
    err(`Push failed after rebase: ${r.stderr}`); return false;
  }

  err(`Push failed: ${r.stderr}`); return false;
}

// ---------------------------------------------------------------------------
// Branch switching
// ---------------------------------------------------------------------------
function switchBranch(name) {
  let r = git("checkout", name);
  if (r.ok) { ok(`Switched to branch: ${name}`); return name; }

  info(`Branch '${name}' not found — creating it...`);
  r = git("checkout", "-b", name);
  if (r.ok) { ok(`Created and switched to: ${name}`); return name; }

  err(`Could not switch/create branch '${name}': ${r.stderr}`);
  return getCurrentBranch();
}

// ---------------------------------------------------------------------------
// First-run welcome
// ---------------------------------------------------------------------------
function firstRunCheck() {
  if (fs.existsSync(WELCOME_MARKER)) return;
  console.log(`
${C.green}${C.bold}  ╔══════════════════════════════════════╗${C.reset}
${C.green}${C.bold}  ║     GTXR is ready to use!         ║${C.reset}
${C.green}${C.bold}  ╚══════════════════════════════════════╝${C.reset}

${C.cyan}  Available commands:${C.reset}
  ${C.bold}gtxr${C.reset}                Run full workflow  (add → commit → push)
  ${C.bold}gtxr setup${C.reset}          Configure AI provider and API key
  ${C.bold}gtxr upgrade${C.reset}        Upgrade to the latest version
  ${C.bold}gtxr uninstall${C.reset}      Remove GitAuto from your system
  ${C.bold}gtxr --no-push${C.reset}      Commit only, skip push
  ${C.bold}gtxr --no-ai${C.reset}        Skip AI, type message manually
  ${C.bold}gtxr --force-push${C.reset}   Force push ${C.dim}(destructive)${C.reset}
  ${C.bold}gtxr --branch <n>${C.reset}   Switch or create branch before committing
  ${C.bold}gtxr --help${C.reset}         Show all commands and options

${C.yellow}  Get started:  gtxr setup${C.reset}
`);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(WELCOME_MARKER, "");
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function printHelp() {
  console.log(`
${C.purple}${C.bold}  ╔══════════════════════════════════════╗${C.reset}
${C.purple}${C.bold}  ║    GTXR — AI Git Automation       ║${C.reset}
${C.purple}${C.bold}  ╚══════════════════════════════════════╝${C.reset}

${C.cyan}  Commands:${C.reset}
  gtxr                  Run full workflow  (add → commit → push)
  gtxr setup            Configure AI provider and API key
  gtxr upgrade          Upgrade to latest version
  gtxr uninstall        Remove GitAuto from your system

${C.cyan}  Options:${C.reset}
  --no-push                Commit only, skip push
  --no-ai                  Skip AI, enter message manually
  --force-push             Force push  (destructive)
  --branch, -b <name>      Switch or create branch before committing
  -v, --version            Print current version
  -h, --help               Show this message

${C.cyan}  Examples:${C.reset}
  gtxr                          Full AI-powered workflow
  gtxr --no-push                Commit only
  gtxr --branch feature/login   Switch branch then commit and push
  gtxr --no-ai                  Manual commit message

${C.yellow}  First time? Run: gtxr setup${C.reset}
`);
}

// ---------------------------------------------------------------------------
// Upgrade
// ---------------------------------------------------------------------------
async function cmdUpgrade() {
  info("Checking for latest version...");
  try {
    const https = require("https");
    const latest = await new Promise((resolve, reject) => {
      https.get(
        "https://registry.npmjs.org/gtxr/latest",
        { headers: { "User-Agent": "gtxr" } },
        (res) => {
          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => {
            try { resolve(JSON.parse(data).version); } catch (e) { reject(e); }
          });
        }
      ).on("error", reject);
    });

    if (latest === VERSION) {
      ok(`Already up to date (v${VERSION}).`);
      return;
    }

    info(`Upgrading v${VERSION} → v${latest}...`);
    const r = spawnSync("npm", ["install", "-g", "gtxr"], {
      encoding: "utf8",
      stdio: "inherit",
    });
    if (r.status === 0) {
      ok(`Upgraded to v${latest} successfully.`);
    } else {
      err("Upgrade failed. Try manually: npm install -g gitauto");
    }
  } catch (e) {
    err(`Upgrade failed: ${e.message}`);
    info("Try manually: npm install -g gitauto");
  }
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------
async function cmdUninstall() {
  warn("This will remove GitAuto and all its data.");
  const confirm = await prompt("Are you sure? (y/N): ");
  if (confirm.toLowerCase() !== "y") {
    info("Uninstall cancelled.");
    return;
  }

  // Remove config directory
  if (fs.existsSync(CONFIG_DIR)) {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    ok(`Removed config: ${CONFIG_DIR}`);
  }

  // npm uninstall
  info("Running: npm uninstall -g gitauto");
  const r = spawnSync("npm", ["uninstall", "-g", "gtxr"], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (r.status === 0) {
    ok("GTXR uninstalled successfully.");
  } else {
    err("npm uninstall failed. Try: npm uninstall -g gitauto");
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
async function cmdSetup() {
  header("GTXR Setup");
  const providerInput = await prompt(`Provider (${PROVIDERS.join("/")}): `);
  const provider = providerInput.toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    warn("Unrecognised provider. Skipped.");
    return;
  }
  const apiKey = await prompt(`API key for ${provider}: `);
  if (!apiKey) { warn("No API key entered. Skipped."); return; }
  saveConfig({ provider, apiKey });
  ok(`${provider} configured successfully.`);
}

// ---------------------------------------------------------------------------
// Get commit message
// ---------------------------------------------------------------------------
async function getCommitMessage(config, diff, noAi) {
  const useAi = config.apiKey && config.provider && !noAi;

  if (!useAi) {
    if (!noAi) warn("AI not configured — run: gtxr setup");
    const msg = await prompt("Commit message: ");
    return msg || null;
  }

  const generate = await prompt("Generate commit message with AI? (y/n) [y]: ");
  if (generate && generate.toLowerCase() !== "y") {
    const msg = await prompt("Commit message: ");
    return msg || null;
  }

  if (!diff) {
    warn("Nothing staged — enter message manually.");
    const msg = await prompt("Commit message: ");
    return msg || null;
  }

  const aiPrompt =
    "Generate a very short (one-line, imperative tense, <=50 chars) " +
    "git commit message summarising the changes below:\n\n" +
    diff.slice(0, 3000);

  while (true) {
    info(`Generating via ${config.provider}...`);
    try {
      const msg = await callAI(config.provider, config.apiKey, aiPrompt);
      if (!msg) throw new Error("Empty response from AI");

      console.log(`\n  ${C.green}${msg}${C.reset}\n`);
      const choice = (await prompt("Use this? (y / r=regenerate / m=manual) [y]: ")).toLowerCase() || "y";

      if (choice === "y") return msg;
      if (choice === "r") continue;
      const manual = await prompt("Commit message: ");
      return manual || null;
    } catch (e) {
      handleAiError(config.provider, e);
      info("Falling back to manual input.");
      const msg = await prompt("Commit message: ");
      return msg || null;
    }
  }
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------
async function run(opts) {
  header(`GTXR v${VERSION}`);

  if (!isGitRepo()) {
    err("Not a git repository. Run 'git init' first.");
    process.exit(1);
  }

  info(`Remote : ${getRemoteUrl()}`);

  let branch = getCurrentBranch();
  if (opts.branch && opts.branch !== branch) {
    branch = switchBranch(opts.branch);
  }
  info(`Branch : ${branch}`);

  const status = getStatus();
  if (!status) {
    warn("No changes detected — nothing to commit.");
    process.exit(0);
  }

  console.log(`\n${C.cyan}Changes:${C.reset}\n${status}\n`);

  // Stage files
  const filesInput = await prompt("Files to add (. for all) [.]: ");
  const files = filesInput || ".";
  const addArgs = files === "." ? ["."] : files.split(" ");
  const addResult = git("add", ...addArgs);
  if (!addResult.ok) {
    err(`Failed to stage files: ${addResult.stderr}`);
    process.exit(1);
  }
  ok(`Staged: ${files}`);

  // Commit message
  const config = loadConfig();
  const diff = getDiff();
  const message = await getCommitMessage(config, diff, opts.noAi);
  if (!message) {
    err("Commit message cannot be empty.");
    process.exit(1);
  }

  // Commit
  const commitResult = git("commit", "-m", message);
  if (!commitResult.ok) {
    err(`Commit failed: ${commitResult.stderr}`);
    process.exit(1);
  }
  ok(`Committed: ${message}`);

  // Push
  if (opts.noPush) {
    info("Skipping push (--no-push).");
    header("Done!");
    return;
  }

  const doPush = (await prompt("Push to remote? (y/n) [y]: ") || "y").toLowerCase() === "y";
  if (doPush) push(branch, opts.forcePush);

  header("Done!");
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------
const VALID_ARGS = new Set([
  "-v", "--version", "-h", "--help",
  "setup", "upgrade", "uninstall",
  "--no-push", "--no-ai", "--force-push",
  "--branch", "-b",
]);

function parseArgs(argv) {
  const opts = {
    version: false, help: false,
    setup: false, upgrade: false, uninstall: false,
    noPush: false, noAi: false, forcePush: false,
    branch: null,
  };

  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const a = args[i].toLowerCase();

    if (!VALID_ARGS.has(a)) {
      err(`Unknown argument: '${args[i]}'`);
      info("Run 'gtxr --help' to see valid commands.");
      process.exit(1);
    }

    switch (a) {
      case "-v": case "--version":   opts.version   = true; break;
      case "-h": case "--help":      opts.help      = true; break;
      case "setup":                  opts.setup     = true; break;
      case "upgrade":                opts.upgrade   = true; break;
      case "uninstall":              opts.uninstall = true; break;
      case "--no-push":              opts.noPush    = true; break;
      case "--no-ai":                opts.noAi      = true; break;
      case "--force-push":           opts.forcePush = true; break;
      case "--branch": case "-b":
        i++;
        if (i >= args.length) {
          err("--branch requires a branch name.");
          process.exit(1);
        }
        opts.branch = args[i];
        break;
    }
    i++;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
(async () => {
  const opts = parseArgs(process.argv);

  if (opts.help)    { printHelp(); process.exit(0); }
  if (opts.version) { console.log(`GTXR v${VERSION}`); process.exit(0); }
  if (opts.upgrade) { await cmdUpgrade(); process.exit(0); }
  if (opts.uninstall){ await cmdUninstall(); process.exit(0); }

  firstRunCheck();

  if (opts.setup) { await cmdSetup(); process.exit(0); }

  try {
    await run(opts);
  } catch (e) {
    err(`Unexpected error: ${e.message}`);
    process.exit(1);
  }
})();