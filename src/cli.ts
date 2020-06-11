
import * as fs from "fs"
import * as path from "path"
import * as http from "http"
import { AddressInfo } from "net";
import findFreePorts from "find-free-ports"
import { spawn } from "child_process"

import { getHtmlFor } from "./index"
import { DebugClient, ProtocolClient } from "./debugClient"
import { CustomNodeDebugSession } from "./nodeDebugAdapter";

const PORT = parseInt(process.env['GRAPHDEBUG_PORT'] ?? '29999');

function verbose(message: string): void {
  console.error(`[verb] ${message}`)
}

async function register() {

  let scriptPath: string | undefined;
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
  if (scriptPath === undefined) {
    throw new Error(`No script specified to run on the command-line.`)
  }

  const [ debugProtoPort ] = await findFreePorts(1);

  const debuggerProc = spawn(require.resolve('vscode-node-debug2/out/nodeDebug'), [`--server=${debugProtoPort}`], { stdio: 'inherit' });

  const session = new ProtocolClient();
  session.start(debuggerProc.stdin, debuggerProc.stdout);
  const client = new DebugClient(session);

  verbose(`Registering events with the current debug adapter`)
  session.addListener('stopped', () => {
    updateGraph();
  });

  await client.initialize();
  await client.waitForEvent('initialized');
  await client.configurationDone();

  console.log(`Launching ${scriptPath}`)
  await client.launch({
    program: scriptPath,
    args: restArgs,
  });

  function updateGraph() {
    console.log('breakpoint triggered');
  }

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

