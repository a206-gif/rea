# Use a complete REA environment from this repository

This checkout contains the REA source, locked dependency graph, CLI/MCP
dispatcher, tracked agent skill, and a checksum-pinned Java/Ghidra toolchain
manifest. An agent can prepare the complete environment without installing REA,
Java, or Ghidra globally and without repeating interactive `rea setup`.

## One-command setup

From the repository root:

```bash
npm run rea:bootstrap:full
```

That single idempotent command:

1. restores the exact npm dependency graph from `package-lock.json`;
2. builds the local REA CLI, MCP server, and packaged skill;
3. selects the matching host entry in `config/repository-toolchain.json`;
4. downloads the pinned official Eclipse Temurin JDK and Ghidra release assets;
5. verifies each archive's exact byte count and SHA-256 digest before extraction;
6. extracts both tools under the ignored `.cache/rea-toolchain/` directory;
7. injects `JAVA_HOME`, `GHIDRA_INSTALL_DIR`, and local tool paths only into
   repository-launched REA child processes; and
8. runs REA's Ghidra-scoped doctor check.

It supports x64 and arm64 hosts on Linux, macOS, and Windows. The downloads total
approximately 741 MiB on x64 Linux and require access to GitHub's official
release-asset redirects. Interrupted curl downloads are retained as `.part`
files and resumed on the next invocation. Extracted tools and archives are
ignored local cache data; they are never committed to Git.

The pinned components are:

- Eclipse Temurin JDK `21.0.12.1+1`, licensed under
  `GPL-2.0-only WITH Classpath-exception-2.0`;
- Ghidra `12.1.4`, licensed under `Apache-2.0`.

Their official URLs, platform archives, exact sizes, and SHA-256 values are
tracked in `config/repository-toolchain.json`. Updating a version requires an
explicit manifest change and review; the bootstrap never resolves an unpinned
"latest" release.

## One-command reverse analysis

For a binary or other Ghidra target, full preparation and analysis can be one
command:

```bash
npm run rea:analyze -- /absolute/path/to/target --json
```

`rea:analyze` completes any missing setup, then runs `rea analyze` with Ghidra
selected by default. All normal REA arguments pass through. An explicit
`--provider NAME` overrides that default.

After the initial preparation, any local REA command automatically receives the
repository Java/Ghidra environment:

```bash
npm run rea:local -- --help
npm run rea:local -- inspect-binary-layout /absolute/path/to/target --json
npm run rea:doctor -- --provider ghidra --json
```

Use the lighter `npm run rea:bootstrap` only when core CLI/MCP functionality is
wanted without downloading Java and Ghidra.

## Read-only status

```bash
npm run rea:status
npm run --silent rea:status -- --json
```

Status separately reports the core runtime and pinned Java/Ghidra toolchain. It
returns success only when both are current and ready. Status does not download,
extract, or modify anything.

## MCP clients

Prepare the complete checkout before starting a client, so a client's startup
timeout is not consumed by large downloads or compilation:

```bash
npm run rea:bootstrap:full
npm run --silent rea:mcp-config -- --json
```

The second command prints an absolute, machine-specific stdio entry containing
the Node executable, repository launcher, and working directory. Translate
those values into the selected client's MCP configuration, or start the server
directly with:

```bash
npm run rea:mcp
```

The launcher applies the repository Java/Ghidra environment internally and
keeps bootstrap diagnostics on stderr, leaving stdout for the MCP protocol.
Client registration is deliberately not committed: supported clients use
different formats and often store absolute paths in user profiles. Restart or
reconnect a client after adding its registration. A repository cannot inject
new MCP tools into an agent session that is already running.

An Arena agent or another shell-capable agent that cannot reload MCP can follow
the tracked `.agents/skills/reverse-engineer-anything/SKILL.md` instructions and
invoke `npm run rea:analyze -- ...` or `npm run rea:local -- ...` through its
shell.

## Portability and storage boundary

| Component                                        | Repository state                         | Fresh-environment action                                |
| ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------- |
| REA source and dispatcher                        | Tracked                                  | None                                                    |
| npm dependency versions                          | Locked in `package-lock.json`            | Full bootstrap restores them                            |
| Agent skill source                               | Tracked under `.agents/skills/`          | Read directly; bootstrap generates packaged `skills/`   |
| CLI and MCP JavaScript                           | Generated `dist/`, intentionally ignored | Full bootstrap builds it                                |
| Java/Ghidra versions and integrity               | Tracked manifest                         | Full bootstrap downloads and verifies official assets   |
| Extracted Java/Ghidra                            | Ignored `.cache/rea-toolchain/`          | Reused while valid; recreated when missing or stale     |
| MCP client registration                          | User/client-specific                     | Use `rea:mcp-config`, then reconnect the client         |
| Hopper, IDA, JADX, adb, and other optional tools | Host-specific                            | Provision separately only when the task requires them   |
| Analysis targets and evidence                    | Local caller-owned data                  | Supply explicit paths; do not commit sensitive evidence |

Large third-party archives are not Git source content. Keeping only their pinned
manifest in Git avoids adding roughly 741 MiB of compressed binaries per
platform to every clone while preserving a reproducible one-command setup.

## Troubleshooting

- If status says `full bootstrap required`, run
  `npm run rea:bootstrap:full`.
- If bootstrap reports an unsupported Node version, select `.nvmrc` or another
  version accepted by `package.json#engines`.
- If downloading fails at a GitHub redirect, allow HTTPS access to GitHub release
  assets and rerun; a curl partial download is resumed automatically.
- Linux and macOS extraction requires `tar` and `unzip`; Windows extraction uses
  built-in PowerShell `Expand-Archive`.
- If Ghidra doctor fails after a verified install, run
  `npm run rea:doctor -- --provider ghidra --json` and use the returned exact
  remediation.
- If a previous process was interrupted and a lock remains, first verify that no
  bootstrap is active, then remove only the named lock under `.cache/` and rerun.
