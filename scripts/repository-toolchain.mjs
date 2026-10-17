import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadVerifiedAsset,
  extractArchive,
} from "./lib/repository-toolchain-io.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(
  repositoryRoot,
  "config",
  "repository-toolchain.json",
);
const toolchainRoot = join(repositoryRoot, ".cache", "rea-toolchain");
const downloadRoot = join(toolchainRoot, "downloads");
const stagingRoot = join(toolchainRoot, "staging");
const lockPath = join(toolchainRoot, "provision.lock");
const markerName = ".rea-toolchain.json";
const supportedDownloadHosts = new Set(["github.com"]);
const lockWaitMilliseconds = 30 * 60_000;
const lockPollMilliseconds = 1_000;

export async function repositoryToolchainStatus() {
  const manifest = await readManifest();
  const platformKey = repositoryPlatformKey();
  const javaAsset = manifest.java.platforms[platformKey];
  if (javaAsset !== undefined) validateAsset(javaAsset, "Java");
  validateAsset(manifest.ghidra, "Ghidra");
  const javaHome = javaInstallPath(manifest, platformKey);
  const ghidraInstallDir = ghidraInstallPath(manifest);
  const javaReady =
    javaAsset !== undefined &&
    (await installationMatches(javaHome, javaAsset.sha256)) &&
    (await exists(javaExecutable(javaHome))) &&
    (await exists(join(javaHome, "release")));
  const ghidraReady =
    (await installationMatches(ghidraInstallDir, manifest.ghidra.sha256)) &&
    (await exists(ghidraHeadlessExecutable(ghidraInstallDir)));
  return {
    platformKey,
    supported: javaAsset !== undefined,
    ready: javaReady && ghidraReady,
    java: {
      name: manifest.java.name,
      version: manifest.java.version,
      license: manifest.java.license,
      home: javaHome,
      ready: javaReady,
      asset: javaAsset ?? null,
    },
    ghidra: {
      name: manifest.ghidra.name,
      version: manifest.ghidra.version,
      license: manifest.ghidra.license,
      installDir: ghidraInstallDir,
      ready: ghidraReady,
      asset: manifest.ghidra,
    },
    downloadBytes:
      javaAsset === undefined
        ? manifest.ghidra.size
        : javaAsset.size + manifest.ghidra.size,
    storageRoot: toolchainRoot,
  };
}

export async function provisionRepositoryToolchain({
  logStream = process.stdout,
} = {}) {
  const manifest = await readManifest();
  const platformKey = repositoryPlatformKey();
  const javaAsset = manifest.java.platforms[platformKey];
  if (javaAsset === undefined) {
    throw new Error(
      `the pinned repository toolchain does not support ${platformKey}; supported platforms: ${Object.keys(manifest.java.platforms).join(", ")}`,
    );
  }
  validateAsset(javaAsset, "Java");
  validateAsset(manifest.ghidra, "Ghidra");
  await mkdir(toolchainRoot, { recursive: true });
  const releaseLock = await acquireLock(logStream);
  try {
    const javaHome = javaInstallPath(manifest, platformKey);
    if (
      !(await installationMatches(javaHome, javaAsset.sha256)) ||
      !(await exists(javaExecutable(javaHome)))
    ) {
      log(
        logStream,
        `Provisioning ${manifest.java.name} ${manifest.java.version} for ${platformKey}...`,
      );
      await installAsset({
        asset: javaAsset,
        destination: javaHome,
        kind: "java",
        version: manifest.java.version,
        logStream,
      });
    } else {
      log(
        logStream,
        `${manifest.java.name} ${manifest.java.version} is already ready.`,
      );
    }

    const ghidraInstallDir = ghidraInstallPath(manifest);
    if (
      !(await installationMatches(ghidraInstallDir, manifest.ghidra.sha256)) ||
      !(await exists(ghidraHeadlessExecutable(ghidraInstallDir)))
    ) {
      log(
        logStream,
        `Provisioning ${manifest.ghidra.name} ${manifest.ghidra.version}...`,
      );
      await installAsset({
        asset: manifest.ghidra,
        destination: ghidraInstallDir,
        kind: "ghidra",
        version: manifest.ghidra.version,
        logStream,
      });
    } else {
      log(
        logStream,
        `${manifest.ghidra.name} ${manifest.ghidra.version} is already ready.`,
      );
    }
  } finally {
    await releaseLock();
  }

  const status = await repositoryToolchainStatus();
  if (!status.ready)
    throw new Error(
      "the repository Java/Ghidra toolchain did not pass post-install validation",
    );
  log(
    logStream,
    "Pinned Java and Ghidra providers are ready inside the repository cache.",
  );
  return status;
}

export async function repositoryToolchainEnvironment(
  baseEnvironment = process.env,
) {
  const status = await repositoryToolchainStatus();
  if (!status.ready) return { ...baseEnvironment };
  const environment = { ...baseEnvironment };
  const pathKey =
    Object.keys(environment).find((key) => key.toLowerCase() === "path") ??
    "PATH";
  const additions = [
    join(status.java.home, "bin"),
    status.ghidra.installDir,
    join(status.ghidra.installDir, "support"),
  ];
  environment.JAVA_HOME = status.java.home;
  environment.GHIDRA_INSTALL_DIR = status.ghidra.installDir;
  environment[pathKey] = [...additions, environment[pathKey]]
    .filter(Boolean)
    .join(delimiter);
  return environment;
}

async function installAsset({ asset, destination, kind, version, logStream }) {
  const archivePath = await downloadVerifiedAsset({
    asset,
    downloadRoot,
    logStream,
  });
  const stagingDirectory = join(
    stagingRoot,
    `${kind}-${process.pid}-${Date.now()}`,
  );
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  try {
    log(logStream, `Extracting ${asset.fileName}...`);
    await extractArchive({
      asset,
      archivePath,
      destination: stagingDirectory,
      logStream,
    });
    const extractedRoot = await findExtractedRoot(stagingDirectory, kind);
    if (extractedRoot === undefined) {
      throw new Error(
        `${asset.fileName} did not contain a valid ${kind} installation root`,
      );
    }
    await rm(destination, { recursive: true, force: true });
    await mkdir(dirname(destination), { recursive: true });
    await rename(extractedRoot, destination);
    if (process.platform !== "win32") {
      if (kind === "java") await chmod(javaExecutable(destination), 0o755);
      else {
        await chmod(ghidraHeadlessExecutable(destination), 0o755);
        const launcher = join(destination, "ghidraRun");
        if (await exists(launcher)) await chmod(launcher, 0o755);
      }
    }
    await writeFile(
      join(destination, markerName),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind,
          version,
          source: asset.url,
          sha256: asset.sha256,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function findExtractedRoot(root, kind, depth = 0) {
  if (depth > 4) return undefined;
  const valid =
    kind === "java"
      ? (await exists(javaExecutable(root))) &&
        (await exists(join(root, "release")))
      : await exists(ghidraHeadlessExecutable(root));
  if (valid) return root;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = await findExtractedRoot(
      join(root, entry.name),
      kind,
      depth + 1,
    );
    if (match !== undefined) return match;
  }
  return undefined;
}

async function installationMatches(destination, expectedSha256) {
  try {
    const marker = JSON.parse(
      await readFile(join(destination, markerName), "utf8"),
    );
    return marker.schemaVersion === 1 && marker.sha256 === expectedSha256;
  } catch {
    return false;
  }
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1)
    throw new Error(
      `unsupported repository toolchain schema: ${manifest.schemaVersion}`,
    );
  return manifest;
}

function validateAsset(asset, label) {
  const url = new URL(asset.url);
  if (url.protocol !== "https:" || !supportedDownloadHosts.has(url.hostname)) {
    throw new Error(`${label} download must use an approved HTTPS origin`);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256))
    throw new Error(`${label} is missing a valid SHA-256 digest`);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0)
    throw new Error(`${label} is missing a valid byte size`);
  if (!asset.fileName || basenameFromUrl(url) !== asset.fileName) {
    throw new Error(`${label} URL and file name do not agree`);
  }
}

function basenameFromUrl(url) {
  return decodeURIComponent(
    url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
  );
}

function repositoryPlatformKey() {
  const architecture =
    process.arch === "x64"
      ? "x64"
      : process.arch === "arm64"
        ? "arm64"
        : process.arch;
  return `${process.platform}-${architecture}`;
}

function javaInstallPath(manifest, platformKey) {
  return join(toolchainRoot, "java", platformKey, manifest.java.version);
}

function ghidraInstallPath(manifest) {
  return join(toolchainRoot, "ghidra", manifest.ghidra.version);
}

function javaExecutable(javaHome) {
  return join(
    javaHome,
    "bin",
    process.platform === "win32" ? "java.exe" : "java",
  );
}

function ghidraHeadlessExecutable(installDir) {
  return join(
    installDir,
    "support",
    process.platform === "win32" ? "analyzeHeadless.bat" : "analyzeHeadless",
  );
}

async function acquireLock(logStream) {
  const startedAt = Date.now();
  let waitWasReported = false;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
      await handle.close();
      return async () => rm(lockPath, { force: true });
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
      if (Date.now() - startedAt >= lockWaitMilliseconds) {
        throw new Error(
          `another toolchain provision still owns ${lockPath}; verify that process before removing the lock`,
        );
      }
      if (!waitWasReported) {
        log(
          logStream,
          "Another agent is provisioning Java/Ghidra; waiting for its lock...",
        );
        waitWasReported = true;
      }
      await delay(lockPollMilliseconds);
    }
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function log(stream, message) {
  stream.write(`${message}\n`);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
