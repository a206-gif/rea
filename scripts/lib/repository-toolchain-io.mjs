import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

export async function downloadVerifiedAsset({
  asset,
  downloadRoot,
  logStream,
}) {
  await mkdir(downloadRoot, { recursive: true });
  const finalPath = join(downloadRoot, asset.fileName);
  if (await archiveMatches(finalPath, asset)) {
    log(logStream, `Using verified cached download ${asset.fileName}.`);
    return finalPath;
  }
  await rm(finalPath, { force: true });
  const partialPath = `${finalPath}.part`;
  log(
    logStream,
    `Downloading ${asset.fileName} (${formatBytes(asset.size)}) from ${new URL(asset.url).hostname}...`,
  );
  const curlResult = await runExternal(
    "curl",
    [
      "--fail",
      "--location",
      "--retry",
      "5",
      "--retry-all-errors",
      "--connect-timeout",
      "30",
      "--continue-at",
      "-",
      "--output",
      partialPath,
      asset.url,
    ],
    { logStream, allowMissing: true },
  );
  if (curlResult.missing) {
    await downloadWithFetch(asset.url, partialPath, logStream);
  } else if (curlResult.exitCode !== 0) {
    throw new Error(
      `curl could not download ${asset.fileName} (exit ${curlResult.exitCode}); allow HTTPS access to GitHub release-asset redirects, then rerun to resume the partial download`,
    );
  }
  const downloaded = await stat(partialPath);
  if (downloaded.size !== asset.size) {
    throw new Error(
      `${asset.fileName} has ${downloaded.size} bytes after download; expected ${asset.size}. The partial file was retained for a resumable retry.`,
    );
  }
  const digest = await digestFile(partialPath);
  if (digest !== asset.sha256) {
    await rm(partialPath, { force: true });
    throw new Error(
      `${asset.fileName} failed SHA-256 verification; expected ${asset.sha256}, received ${digest}`,
    );
  }
  await rename(partialPath, finalPath);
  log(logStream, `Verified ${asset.fileName}: sha256:${digest}.`);
  return finalPath;
}

export async function extractArchive({
  asset,
  archivePath,
  destination,
  logStream,
}) {
  if (asset.archive === "tar.gz") {
    await runExternalChecked(
      "tar",
      ["-xzf", archivePath, "-C", destination],
      logStream,
    );
    return;
  }
  if (asset.archive !== "zip")
    throw new Error(`unsupported archive format: ${asset.archive}`);
  if (process.platform === "win32") {
    await runExternalChecked(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:REA_ARCHIVE -DestinationPath $env:REA_DESTINATION -Force",
      ],
      logStream,
      { REA_ARCHIVE: archivePath, REA_DESTINATION: destination },
    );
    return;
  }
  await runExternalChecked(
    "unzip",
    ["-q", archivePath, "-d", destination],
    logStream,
  );
}

async function downloadWithFetch(url, destination, logStream) {
  await rm(destination, { force: true });
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "rea-repository-toolchain/1" },
  });
  if (!response.ok || response.body === null) {
    throw new Error(
      `download failed with HTTP ${response.status} ${response.statusText}`,
    );
  }
  const progress = createProgressTransform(response.body, logStream);
  await pipeline(
    Readable.fromWeb(progress),
    createWriteStream(destination, { flags: "wx" }),
  );
}

function createProgressTransform(body, logStream) {
  let downloaded = 0;
  let lastReport = Date.now();
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        downloaded += chunk.byteLength;
        if (Date.now() - lastReport >= 5_000) {
          log(logStream, `Downloaded ${formatBytes(downloaded)}...`);
          lastReport = Date.now();
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

async function archiveMatches(path, asset) {
  try {
    const details = await stat(path);
    return (
      details.size === asset.size && (await digestFile(path)) === asset.sha256
    );
  } catch {
    return false;
  }
}

async function digestFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function runExternalChecked(
  executable,
  arguments_,
  logStream,
  additionalEnvironment = {},
) {
  const result = await runExternal(executable, arguments_, {
    logStream,
    additionalEnvironment,
  });
  if (result.missing)
    throw new Error(
      `${executable} is required to extract the pinned toolchain archive`,
    );
  if (result.exitCode !== 0)
    throw new Error(`${executable} exited with status ${result.exitCode}`);
}

function runExternal(
  executable,
  arguments_,
  { logStream, allowMissing = false, additionalEnvironment = {} },
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, arguments_, {
      env: { ...process.env, ...additionalEnvironment },
      stdio: ["ignore", logStream, logStream],
      windowsHide: true,
    });
    child.once("error", (error) => {
      if (allowMissing && error && error.code === "ENOENT")
        resolvePromise({ missing: true, exitCode: null });
      else rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      if (signal)
        rejectPromise(new Error(`${executable} exited from signal ${signal}`));
      else resolvePromise({ missing: false, exitCode: code ?? 1 });
    });
  });
}

function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function log(stream, message) {
  stream.write(`${message}\n`);
}
