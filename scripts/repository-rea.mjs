#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  provisionRepositoryToolchain,
  repositoryToolchainEnvironment,
  repositoryToolchainStatus,
} from "./repository-toolchain.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = join(repositoryRoot, ".cache");
const statePath = join(cacheDirectory, "repository-rea-bootstrap.json");
const lockPath = join(cacheDirectory, "repository-rea-bootstrap.lock");
const dispatcherPath = join(repositoryRoot, "scripts", "rea.mjs");
const requiredRuntimeFiles = [
  join(repositoryRoot, "dist", "mcp", "main.js"),
  join(repositoryRoot, "dist", "cli-runtime", "cli.js"),
  join(repositoryRoot, "skills", "reverse-engineer-anything", "SKILL.md"),
];
const fingerprintRoots = [
  ".agents/skills/reverse-engineer-anything",
  "bridge",
  "native/windows",
  "scripts",
  "src",
];
const fingerprintFiles = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "turbo.json",
];
const lockWaitMilliseconds = 10 * 60_000;
const lockPollMilliseconds = 500;

const [command = "help", ...commandArguments] = process.argv.slice(2);
const jsonOutput =
  commandArguments.includes("--json") && ["status", "config"].includes(command);
const forwardedArguments = commandArguments.filter(
  (argument) => argument !== "--",
);

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "status") {
    const status = await repositoryStatus();
    if (jsonOutput)
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else printStatus(status);
    process.exitCode = status.runtimeReady && status.toolchain.ready ? 0 : 1;
  } else if (command === "config") {
    const config = repositoryMcpConfiguration();
    if (jsonOutput)
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    else {
      process.stdout.write("Repository-local REA MCP configuration:\n");
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    }
  } else if (command === "bootstrap") {
    await bootstrap({ protocolSafe: false });
    printStatus(await repositoryStatus());
  } else if (command === "bootstrap-full") {
    await bootstrap({ protocolSafe: false });
    await provisionRepositoryToolchain({ logStream: process.stdout });
    const environment = await repositoryToolchainEnvironment();
    printStatus(await repositoryStatus());
    await runChecked(
      process.execPath,
      [dispatcherPath, "doctor", "--provider", "ghidra"],
      false,
      environment,
    );
  } else if (command === "analyze") {
    await bootstrap({ protocolSafe: true });
    await provisionRepositoryToolchain({ logStream: process.stderr });
    const environment = await repositoryToolchainEnvironment();
    const analysisArguments = ["analyze", ...forwardedArguments];
    if (!hasProviderSelection(forwardedArguments)) {
      analysisArguments.push("--provider", "ghidra");
    }
    process.exitCode = await run(
      process.execPath,
      [dispatcherPath, ...analysisArguments],
      false,
      environment,
    );
  } else if (command === "run") {
    await bootstrap({ protocolSafe: true });
    const environment = await repositoryToolchainEnvironment();
    process.exitCode = await run(
      process.execPath,
      [dispatcherPath, ...forwardedArguments],
      false,
      environment,
    );
  } else if (command === "doctor") {
    await bootstrap({ protocolSafe: true });
    const environment = await repositoryToolchainEnvironment();
    process.exitCode = await run(
      process.execPath,
      [dispatcherPath, "doctor", ...forwardedArguments],
      false,
      environment,
    );
  } else if (command === "mcp") {
    await bootstrap({ protocolSafe: true });
    const environment = await repositoryToolchainEnvironment();
    process.exitCode = await run(
      process.execPath,
      [dispatcherPath, "mcp"],
      false,
      environment,
    );
  } else {
    throw new Error(
      `Unknown repository REA command: ${command}. Run with --help.`,
    );
  }
} catch (error) {
  process.stderr.write(
    `Repository-local REA failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

async function bootstrap({ protocolSafe }) {
  assertSupportedNode();
  await mkdir(cacheDirectory, { recursive: true });
  const releaseLock = await acquireLock(protocolSafe);
  try {
    const packageLockSha256 = await digestFile(
      join(repositoryRoot, "package-lock.json"),
    );
    let previous = await readBootstrapState();
    const dependenciesReady =
      previous?.packageLockSha256 === packageLockSha256 &&
      (await exists(
        join(repositoryRoot, "node_modules", ".package-lock.json"),
      ));
    if (!dependenciesReady) {
      log(
        protocolSafe,
        "Installing the repository's locked npm dependencies (one-time for this checkout)...",
      );
      await runChecked(
        npmCommand(),
        ["ci", "--no-audit", "--no-fund"],
        protocolSafe,
      );
      previous = undefined;
    }

    const sourceSha256 = await sourceFingerprint();
    const runtimeFilesReady = await allExist(requiredRuntimeFiles);
    const buildReady =
      runtimeFilesReady &&
      previous?.packageLockSha256 === packageLockSha256 &&
      previous?.sourceSha256 === sourceSha256;
    if (!buildReady) {
      log(
        protocolSafe,
        "Building the repository-local REA runtime and skill...",
      );
      await runChecked(npmCommand(), ["run", "build:cached"], protocolSafe);
      if (!(await allExist(requiredRuntimeFiles))) {
        throw new Error(
          "build completed without producing the required CLI, MCP, and skill files",
        );
      }
    }

    await writeBootstrapState({
      schemaVersion: 1,
      packageVersion: await packageVersion(),
      packageLockSha256,
      sourceSha256,
      nodeVersion: process.versions.node,
      preparedAt: new Date().toISOString(),
    });
    log(
      protocolSafe,
      "Repository-local REA is ready; no global REA installation or rea setup was used.",
    );
  } finally {
    await releaseLock();
  }
}

async function repositoryStatus() {
  const packageLockSha256 = await digestFile(
    join(repositoryRoot, "package-lock.json"),
  );
  const sourceSha256 = await sourceFingerprint();
  const state = await readBootstrapState();
  const dependenciesReady = await exists(
    join(repositoryRoot, "node_modules", ".package-lock.json"),
  );
  const runtimeFilesReady = await allExist(requiredRuntimeFiles);
  const runtimeReady = Boolean(
    dependenciesReady &&
    runtimeFilesReady &&
    state?.packageLockSha256 === packageLockSha256 &&
    state?.sourceSha256 === sourceSha256,
  );
  const toolchain = await repositoryToolchainStatus();
  return {
    repositoryRoot,
    packageVersion: await packageVersion(),
    node: {
      version: process.versions.node,
      supported: supportedNode(process.versions.node),
    },
    dependenciesReady,
    runtimeFilesReady,
    runtimeReady,
    bootstrapState: state,
    toolchain,
    mcp: repositoryMcpConfiguration(),
    externalProviders: {
      bundled: false,
      note: "Pinned Eclipse Temurin and Ghidra releases can be provisioned into the ignored repository cache with rea:bootstrap:full. Hopper, IDA, JADX, adb, and other providers remain host prerequisites.",
    },
  };
}

function repositoryMcpConfiguration() {
  return {
    command: process.execPath,
    args: [join(repositoryRoot, "scripts", "repository-rea.mjs"), "mcp"],
    cwd: repositoryRoot,
    note: "Run `npm run rea:bootstrap:full` once before starting an MCP client in a fresh checkout, then restart or reconnect that client.",
  };
}

function printStatus(status) {
  process.stdout.write("Repository-local REA status\n");
  process.stdout.write(
    `  Package:       rea-agents ${status.packageVersion}\n`,
  );
  process.stdout.write(
    `  Node.js:       ${status.node.version} (${status.node.supported ? "supported" : "unsupported"})\n`,
  );
  process.stdout.write(
    `  Dependencies:  ${status.dependenciesReady ? "ready" : "missing or stale"}\n`,
  );
  process.stdout.write(
    `  Built runtime: ${status.runtimeFilesReady ? "present" : "missing"}\n`,
  );
  process.stdout.write(
    `  Core runtime:  ${status.runtimeReady ? "ready" : "bootstrap required"}\n`,
  );
  process.stdout.write(
    `  Java/Ghidra:   ${status.toolchain.ready ? "ready" : "full bootstrap required"}\n`,
  );
  process.stdout.write(
    `  Full analysis: ${status.runtimeReady && status.toolchain.ready ? "ready" : "full bootstrap required"}\n`,
  );
  process.stdout.write(
    "  Other tools:   host prerequisites; not vendored in Git\n",
  );
}

function printHelp() {
  process.stdout.write(
    `Repository-local REA launcher\n\nUsage:\n  node scripts/repository-rea.mjs status [--json]\n  node scripts/repository-rea.mjs bootstrap\n  node scripts/repository-rea.mjs bootstrap-full\n  node scripts/repository-rea.mjs analyze -- <target and rea arguments...>\n  node scripts/repository-rea.mjs run -- <rea arguments...>\n  node scripts/repository-rea.mjs doctor -- <doctor arguments...>\n  node scripts/repository-rea.mjs mcp\n  node scripts/repository-rea.mjs config [--json]\n\nRecommended npm aliases:\n  npm run rea:status\n  npm run rea:bootstrap:full\n  npm run rea:analyze -- /absolute/path/to/target --json\n  npm run rea:local -- --help\n  npm run rea:doctor -- --json\n  npm run rea:mcp\n\nThe full bootstrap restores locked npm dependencies, builds ignored outputs, and downloads checksum-pinned official Eclipse Temurin and Ghidra releases into .cache.\nIt does not install REA or providers globally, require administrator access, or edit agent configuration.\n`,
  );
}

async function acquireLock(protocolSafe) {
  const startedAt = Date.now();
  let waitWasReported = false;
  for (;;) {
    try {
      const handle = await open(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
      if (Date.now() - startedAt >= lockWaitMilliseconds) {
        throw new Error(
          `another repository bootstrap still owns ${lockPath}; verify that process before removing the lock`,
        );
      }
      if (!waitWasReported) {
        log(
          protocolSafe,
          "Another agent is preparing repository-local REA; waiting for its lock...",
        );
        waitWasReported = true;
      }
      await delay(lockPollMilliseconds);
    }
  }
}

async function readBootstrapState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    return undefined;
  }
}

async function writeBootstrapState(value) {
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
}

async function sourceFingerprint() {
  const files = [];
  for (const path of fingerprintFiles) {
    const absolute = join(repositoryRoot, path);
    if (await exists(absolute)) files.push(absolute);
  }
  for (const path of fingerprintRoots) {
    const absolute = join(repositoryRoot, path);
    if (await exists(absolute)) await collectFiles(absolute, files);
  }
  files.sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  for (const path of files) {
    const name = relative(repositoryRoot, path).replaceAll("\\", "/");
    const bytes = await readFile(path);
    hash.update(`${name}\0${bytes.length}\0`);
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(path, output);
    else if (entry.isFile()) output.push(path);
  }
}

async function packageVersion() {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  return packageJson.version;
}

async function digestFile(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function allExist(paths) {
  return (await Promise.all(paths.map(exists))).every(Boolean);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertSupportedNode() {
  if (!supportedNode(process.versions.node)) {
    throw new Error(
      `Node.js ${process.versions.node} is unsupported; use 22.19+, 24.11+, or 26+ as declared by package.json`,
    );
  }
}

function supportedNode(version) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return (
    (major === 22 && minor >= 19) ||
    (major === 24 && minor >= 11) ||
    major >= 26
  );
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function hasProviderSelection(arguments_) {
  return arguments_.some(
    (argument) =>
      argument === "--provider" || argument.startsWith("--provider="),
  );
}

async function runChecked(
  executable,
  args,
  protocolSafe,
  environment = process.env,
) {
  const exitCode = await run(executable, args, protocolSafe, environment);
  if (exitCode !== 0)
    throw new Error(
      `${executable} ${args.join(" ")} exited with status ${exitCode}`,
    );
}

function run(executable, args, protocolSafe, environment = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: protocolSafe
        ? ["inherit", process.stderr, process.stderr]
        : "inherit",
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (signal)
        rejectPromise(new Error(`${executable} exited from signal ${signal}`));
      else resolvePromise(code ?? 1);
    });
  });
}

function log(protocolSafe, message) {
  (protocolSafe ? process.stderr : process.stdout).write(`${message}\n`);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
