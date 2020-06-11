
import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import * as net from "net"
import * as http from "http"
import { AddressInfo } from "net";
import { spawn } from "child_process"
import findFreePorts from "find-free-ports"

import minimist from "minimist"
import { DebugProtocol } from "vscode-debugprotocol"
import { DebugSession, CapabilitiesEvent } from "vscode-debugadapter"
import { ICommonRequestArgs, ChromeDebugSession, ScriptContainer, ChromeDebugAdapter, Breakpoints } from "vscode-chrome-debug-core"

import { getHtmlFor } from "./index"
import { rejects } from "assert"

const PORT = parseInt(process.env['GRAPHDEBUG_PORT'] ?? '29999');

const DEBUGPROTOCOL_REQUEST_TIMEOUT = 1000;

const NODE_INTERNALS_DISPLAY_STR = '<node_internals>';

interface MapLike<T> { [key: string]: T }

export interface CommonRequestArguments extends ICommonRequestArgs {
  stopOnEntry?: boolean;
  address?: string;
  timeout?: number;
  /** Optional cwd for sourceMapPathOverrides resolution */
  cwd?: string;
  /** Request frontend to restart session on termination. */
  restart?: boolean;
  /** Don't set breakpoints in JS files that don't have sourcemaps */
  disableOptimisticBPs?: boolean;
}

/**
 * This interface should always match the schema found in the node-debug extension manifest.
 */
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments, CommonRequestArguments {
  /** An absolute path to the program to debug. */
  program: string;
  /** Optional arguments passed to the debuggee. */
  args?: string[];
  /** Launch the debuggee in this working directory (specified as an absolute path). If omitted the debuggee is lauched in its own directory. */
  cwd: string;
  /** Absolute path to the runtime executable to be used. Default is the runtime executable on the PATH. */
  runtimeExecutable?: string;
  /** Optional arguments passed to the runtime executable. */
  runtimeArgs?: string[];
  /** Optional environment variables to pass to the debuggee. The string valued properties of the 'environmentVariables' are used as key/value pairs. */
  env?: MapLike<string | null>;
  envFile?: string;
  /** Manually selected debugging port */
  port?: number;
}

class NodeScriptContainer extends ScriptContainer {

  /**
   * If realPath is an absolute path or a URL, return realPath. Otherwise, prepend the node_internals marker
   */
  public realPathToDisplayPath(realPath: string): string {
      if (!realPath.match(/VM\d+/) && !path.isAbsolute(realPath)) {
          return `${NODE_INTERNALS_DISPLAY_STR}/${realPath}`;
      }
      return super.realPathToDisplayPath(realPath);
  }

  /**
   * If displayPath starts with the NODE_INTERNALS indicator, strip it.
   */
  public displayPathToRealPath(displayPath: string): string {
      const match = displayPath.match(new RegExp(`^${NODE_INTERNALS_DISPLAY_STR}[\\\\/](.*)`));
      return match ? match[1] : super.displayPathToRealPath(displayPath);
  }

}

class NodeBreakpoints extends Breakpoints {

}

function stripBOM(s: string): string {
  if (s && s[0] === '\uFEFF') {
    s = s.substr(1);
  }
  return s;
}

function readFile(filepath: string, encoding: BufferEncoding = 'utf8'): string | null {
  try {
    return fs.readFileSync(filepath, encoding);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }
    throw e;
  }
}

function collectEnvFileArgs(envFile: string): MapLike<string> {
  const text = readFile(envFile, 'utf8');
  if (text === null) {
    return {}; 
  }
  const env: MapLike<string> = {};
  stripBOM(text).split('\n').forEach(line => {
    const r = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
    if (r !== null) {
      const key = r[1];
      if (!process.env[key]) {	// .env variables never overwrite existing variables (see #21169)
        let value = r[2] || '';
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/\\n/gm, '\n');
        }
        env[key] = value.replace(/(^['"]|['"]$)/g, '');
      }
    }
  });
  return env;
}

class NodeDebugAdapter extends ChromeDebugAdapter {

  protected async doAttach(port: number, targetUrl?: string, address?: string, timeout?: number, websocketUrl?: string, extraCRDPChannelPort?: number): Promise<void> {
    await super.doAttach(port, targetUrl, address, timeout, websocketUrl, extraCRDPChannelPort);
  }

  public async configurationDone() {
    super.sendInitializedEvent();
    this.events.emit(ChromeDebugSession.FinishedStartingUpEventName, { onPaused: true });
    await super.configurationDone();
  }

  public async launch(args: LaunchRequestArguments): Promise<void> {
    await super.launch(args);
    const shouldDebug = !(args.noDebug ?? false);
    console.log("HERE")
    const [ inspectPort ] = await findFreePorts(1);
    console.log('HORE')
    const scriptPath = args.program;
    const runtimeArgs = args.runtimeArgs ?? [];
    let env = { ...process.env, ...args.env };
    if (args.envFile !== undefined) {
      env = { ...collectEnvFileArgs(args.envFile), ...env };
    }
    const cwd = args.cwd ?? path.dirname(scriptPath);
    const spawned = spawn(process.argv0, [`--inspect-brk=${inspectPort}`, ...runtimeArgs, ...process.argv.slice(2)], { env, stdio: 'inherit' })
    spawned.on('error', err => { throw err; });
    spawned.on('exit', code => {
      const msg = code !== 0 
        ? `Process exited with non-zero exit code ${code}.`
        : `Process exited sucessfully with exit code ${code}.`;
      this.terminateSession(msg);
    });
    if (!shouldDebug) {
      await this.doAttach(inspectPort, undefined, args.address, args.timeout, undefined, args.extraCRDPChannelPort)
      this._session.sendEvent(new CapabilitiesEvent({}));
    }
  }

}

class NodeDebugSession extends ChromeDebugSession {
  constructor(debuggerLinesStartAt1: boolean, isServer: boolean) {
    super(debuggerLinesStartAt1, isServer, {
      logFilePath: path.join(os.tmpdir(), 'graphdebug-node.txt'),
      extensionName: 'graphdebug',
      adapter: NodeDebugAdapter,
      breakpoints: NodeBreakpoints,
      scriptContainer: ScriptContainer,
    })
  } 
}

async function register() {
  
  let scriptPath: string;
  let restArgs: string[] = [];

  let i = 2
  for (; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg.startsWith('-')) {
      scriptPath = arg;
      break;
    } else {
      restArgs.push(arg);
    }
  }
  for (; i < process.argv.length; i++) {
    restArgs.push(process.argv[i]);
  }

  const [ debugProtoPort ] = await findFreePorts(1);

  const debugProtoServer = net.createServer(socket => {
    const session = new NodeDebugSession(false, true);
    session.setRunAsServer(true);
    session.start(socket, socket);
  })

  debugProtoServer.listen(debugProtoPort, () => {
    const connection = net.createConnection(debugProtoPort)
    const socket = net.createConnection(debugProtoPort)
    socket.on('connect', () => {
      const session = new NodeDebugSession(false, false);
      session.start(socket, socket);
      console.log(`Launching ${scriptPath}`)
      session.addListener('breakpoint', () => {
        updateGraph();
      })
      session.sendRequest('launch', {
        program: scriptPath,
        args: restArgs,
      }, DEBUGPROTOCOL_REQUEST_TIMEOUT, res => {
        console.log(res);
      })
    })
  })

  function updateGraph() {
    console.log('breakpoint triggered');
  }

  const args = minimist(process.argv.slice(2));

  const server = http.createServer((req, res) => {
    const html = getHtmlFor(path.resolve(__dirname, 'script.js'));
    res.write(html);
    res.end();
  });

  server.listen(PORT, () => {
    console.log(`Serving application on http://localhost:${(server.address()! as AddressInfo).port}/`)
  });

  process.on('exit', () => {
    //server.close();
  });

}

register();

