import {
  createBashToolDefinition,
  createLocalBashOperations,
  getAgentDir,
  type BashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
  BASH_WALL_FALLBACK_SECONDS,
  isWalkLikeCommand,
  resolveBashTimeout,
} from "./web-bash-guard";
import { applyAdminSshEnvironment } from "./admin-ssh";
import { resolveAgentBashCwd, rewriteVirtualCodeText } from "./dual-roots";

const HOST_EXTENSION_NAME = "pi-web-project-command-environment";
const HOST_EXTENSION_PATH = `<inline:${HOST_EXTENSION_NAME}>`;
// Pi's own abort path settles well within this once the process tree is gone.
const ABORT_SETTLE_GRACE_MS = 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ProjectShellSettings = {
  getShellCommandPrefix(): string | undefined;
  getShellPath(): string | undefined;
};

type ProjectCommandBashOperationsOptions = {
  abortSettleGraceMs?: number;
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  idleSeconds?: number;
  startGraceSeconds?: number;
  localOperations?: BashOperations;
  platform?: NodeJS.Platform;
  shellPath?: string;
  admin?: string;
};

type BashExecResult = Awaited<ReturnType<BashOperations["exec"]>>;

function isHostRuntimeVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return comparableName === "PORT"
    || comparableName === "NODE_ENV"
    || comparableName.startsWith("NEXT_")
    // The browser login password guards this server; commands run on behalf of
    // a project (and the model reading their output) have no use for it.
    || comparableName === "PI_WEB_PASSWORD";
}

export function sanitizeProjectCommandEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (isHostRuntimeVariable(name, platform)) delete environment[name];
  }
  return environment;
}

function withAgentBinDirectory(
  environment: NodeJS.ProcessEnv,
  agentBinDir: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathKey = platform === "win32"
    ? Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
    : "PATH";
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const currentPath = environment[pathKey] ?? "";
  const pathEntries = currentPath.split(pathDelimiter).filter(Boolean);
  if (!pathEntries.includes(agentBinDir)) {
    environment[pathKey] = [agentBinDir, currentPath].filter(Boolean).join(pathDelimiter);
  }
  return environment;
}

export function createProjectCommandBashOperations(
  options: ProjectCommandBashOperationsOptions = {},
): BashOperations {
  const {
    abortSettleGraceMs = ABORT_SETTLE_GRACE_MS,
    agentBinDir = join(getAgentDir(), "bin"),
    baseEnvironment = process.env,
    idleSeconds = 0,
    startGraceSeconds = 0,
    localOperations = createLocalBashOperations({ shellPath: options.shellPath }),
    platform = process.platform,
    admin = "",
  } = options;

  return {
    exec(command, cwd, executionOptions) {
      const resolvedCommand = rewriteVirtualCodeText(command);
      const resolvedCwd = resolveAgentBashCwd(cwd);
      const environment = applyAdminSshEnvironment(
        withAgentBinDirectory(
          sanitizeProjectCommandEnvironment(executionOptions.env ?? baseEnvironment, platform),
          agentBinDir,
          platform,
        ),
        admin,
        platform,
      );
      const { onData, signal, timeout } = executionOptions;
      const walkLike = isWalkLikeCommand(command);
      let released = false;
      let settled = false;
      let settle: ((error?: Error, result?: BashExecResult) => void) | undefined;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const release = () => {
        released = true;
        if (idleTimer) clearTimeout(idleTimer);
        for (const timer of timers) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const armIdle = (seconds: number) => {
        if (idleTimer) clearTimeout(idleTimer);
        if (!(seconds > 0)) return;
        idleTimer = setTimeout(() => {
          const err = new Error(`idle:${seconds}`);
          release();
          settle?.(err);
        }, Math.min(seconds * 1000, MAX_TIMER_DELAY_MS));
      };
      const onAbort = () => {
        timers.push(setTimeout(() => {
          const err = new Error("aborted");
          release();
          settle?.(err);
        }, abortSettleGraceMs));
      };

      const execution = localOperations.exec(resolvedCommand, resolvedCwd, {
        ...executionOptions,
        env: environment,
        // Callers finalize their output once the command is released; a
        // survivor must not append to it afterwards.
        onData: (data) => {
          if (released) return;
          // Streaming find/fd/rglob is not progress; do not reset the idle fuse.
          if (!walkLike) armIdle(idleSeconds);
          onData(data);
        },
      });
      // Pi rejects any other timeout before it starts the command.
      const timeoutMs = typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
        ? timeout * 1000
        : undefined;
      const needWrap = Boolean(signal) || timeoutMs !== undefined || idleSeconds > 0 || startGraceSeconds > 0;
      if (!needWrap) return execution;

      // On Stop or a timeout, pi kills the shell's process tree but then keeps
      // reading until every inherited stdout/stderr handle falls idle. A
      // descendant the kill cannot reach (its own session on POSIX, an orphan
      // `taskkill /T` misses on Windows) can keep writing and hold the tool
      // call, and with it Stop and any steering, until the script ends on its
      // own (#647). The errors are pi's own, so the bash tool reports them as
      // "Command aborted" and "Command timed out".
      return new Promise<BashExecResult>((resolve, reject) => {
        settle = (error, result) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve(result as BashExecResult);
        };
        if (timeoutMs !== undefined) {
          timers.push(setTimeout(() => {
            const err = new Error(`timeout:${timeout}`);
            release();
            settle?.(err);
          }, Math.min(timeoutMs + abortSettleGraceMs, MAX_TIMER_DELAY_MS)));
        }
        armIdle(startGraceSeconds);
        execution.then((result) => {
          release();
          settle?.(undefined, result);
        }, (error: unknown) => {
          release();
          settle?.(error instanceof Error ? error : new Error(String(error)));
        });
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export function createProjectCommandBashExtension(options: {
  cwd: string;
  settings: ProjectShellSettings;
  admin?: string;
}): InlineExtension {
  return {
    name: HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const displayDefinition = createBashToolDefinition(options.cwd);
      pi.registerTool({
        ...displayDefinition,
        async execute(toolCallId, params, signal, onUpdate, context) {
          const command = String((params as { command?: string })?.command || "");
          const executionDefinition = createBashToolDefinition(options.cwd, {
            commandPrefix: options.settings.getShellCommandPrefix(),
            operations: createProjectCommandBashOperations({
              shellPath: options.settings.getShellPath(),
              admin: options.admin,
            }),
          });
          const asked = resolveBashTimeout((params as { timeout?: unknown })?.timeout);
          const timeout = asked ?? BASH_WALL_FALLBACK_SECONDS;
          return executionDefinition.execute(
            toolCallId,
            { ...(params as object), command, timeout } as { command: string; timeout?: number },
            signal,
            onUpdate,
            context,
          );
        },
      });
    },
  };
}

export function preferUserBashExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === HOST_EXTENSION_PATH);
  if (hostExtensionIndex < 0) return base;

  const userBashOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has("bash"));
  if (!userBashOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === HOST_EXTENSION_PATH
      && error.error === `Tool "bash" conflicts with ${userBashOwner.path}`
    )),
  };
}
