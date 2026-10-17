# Use REA directly from this repository

This checkout contains the REA source, the locked dependency graph, the CLI/MCP
dispatcher, and the source skill at
`.agents/skills/reverse-engineer-anything/`. Agents should use those files rather
than downloading `rea-agents@latest`, installing a global `rea`, or repeating the
interactive setup flow.

## Quick start for an agent

From the repository root:

```bash
# Read-only: reports whether generated runtime files are ready.
npm run rea:status

# First use in a fresh checkout: restore the lockfile and build local outputs.
npm run rea:bootstrap

# Use the local CLI.
npm run rea:local -- --help
npm run rea:local -- analyze /absolute/path/to/target --json

# Inspect core and provider readiness.
npm run rea:doctor -- --json
```

`rea:bootstrap` is safe to rerun. It fingerprints the lockfile and build inputs,
serializes concurrent preparation attempts, and skips work while the prepared
state is current. It runs `npm ci` only when locked dependencies are absent or
stale, then runs the repository's cached build only when required. Its generated
state is kept under ignored `.cache/`; `node_modules/`, `dist/`, and generated
`skills/` remain ignored outputs.

The bootstrap does **not**:

- install REA globally or run `npx rea-agents`;
- change any agent/client configuration;
- copy the skill into a user profile;
- install or upgrade Node.js, npm, Java, Ghidra, Hopper, IDA, JADX, adb, or other
  provider software.

Use the Node.js range declared in `package.json`; maintainers should use the
exact versions pinned by `.nvmrc` and `package.json#packageManager`.

## MCP clients

Prepare the checkout before starting a client, so a client's startup timeout is
not consumed by dependency installation or compilation:

```bash
npm run rea:bootstrap
npm run rea:mcp-config -- --json
```

The second command prints an absolute, machine-specific stdio entry containing
the Node executable, repository launcher, and working directory. Translate those
three values into the selected client's MCP configuration, or start the stdio
server directly with:

```bash
npm run rea:mcp
```

The launcher keeps all bootstrap diagnostics on stderr in MCP mode so stdout
remains reserved for the protocol. Client registration is deliberately not
committed: supported clients use different configuration formats and many store
absolute paths in user profiles. After adding or changing a registration,
restart or reconnect the client. A repository cannot inject tools into an
agent session that is already running.

An Arena agent (or another shell-capable agent) that cannot reload MCP can still
follow the tracked skill and invoke `npm run rea:local -- ...` through its shell.
This uses exactly the same repository runtime.

## What is and is not portable

| Component                       | Repository state                         | Fresh-environment action                                                  |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| REA source and dispatcher       | Tracked                                  | None                                                                      |
| npm dependency versions         | Locked in `package-lock.json`            | `rea:bootstrap` restores them                                             |
| Agent skill source              | Tracked under `.agents/skills/`          | Read directly; bootstrap also generates packaged `skills/`                |
| CLI and MCP JavaScript          | Generated `dist/`, intentionally ignored | `rea:bootstrap` builds it                                                 |
| MCP client registration         | User/client-specific                     | Use `rea:mcp-config`, then reconnect the client                           |
| Java/Ghidra and other providers | Bring-your-own host tools                | Install lawfully outside Git and expose their documented path/environment |
| Analysis targets and evidence   | Local caller-owned data                  | Supply explicit paths; do not commit sensitive evidence                   |

The source checkout is therefore self-contained as a **reproducible REA project**,
not as a prebuilt operating-system image. Git intentionally does not carry npm's
generated dependency tree, compiled outputs, proprietary tools, large provider
installations, credentials, or host-specific client configuration.

## Troubleshooting

- If `rea:status` says `bootstrap required`, run `npm run rea:bootstrap`.
- If bootstrap reports an unsupported Node version, select the repository's
  `.nvmrc` toolchain (or another version accepted by `package.json#engines`).
- If core REA is ready but a provider is unavailable, use
  `npm run rea:doctor -- --json` and provision only the provider required for the
  task. Do not rerun global REA setup as a substitute for a missing provider.
- If a previous bootstrap process was interrupted and a lock remains, first
  verify that no bootstrap process is running, then remove only
  `.cache/repository-rea-bootstrap.lock` and rerun the command.
