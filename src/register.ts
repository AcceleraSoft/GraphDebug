
import * as net from "net"
import * as path from "path"
import * as http from "http"
import { spawn } from "child_process"
import { AddressInfo } from "net";

import { LoggingDebugSession } from "vscode-debugadapter"

import { getHtmlFor } from "./index"

const PORT = parseInt(process.env['GRAPHDEBUG_PORT'] ?? '29999');

async function register(options = {}) {

  const port = options.port ?? 9229

  let debugAdapterCapabilities = {};

  // Create the debug session and let it connect to this running debugger
  const session = new LoggingDebugSession('debugadapter.log', );
  session.setRunAsServer(true);
  const socket = net.createConnection(port, '127.0.0.1')
  session.start(socket, socket);

  function updateGraph() {
    console.log('breakpoint triggered');
    session.sendRequest('threads', {}, 100, res => {
      console.log(res);
    })
  }

  session.addListener('breakpoint', updateGraph);

  session.on('initialized', () => {
    console.log(`Debug adapter finished initializing.`);
  });

  console.log(`Debug adapter is initializing itself ...`);
  session.sendRequest('initialize', { clientID: 'debuggraph-standalone', clientName: 'DebugGraph CLI Tool' }, 100, res => {
    if (!res) {
      console.log(`Debug adapter initialization sequence failed.`);
      process.exit(1);
    }
    if (res.body.supportsConfigurationDoneRequest) {
      session.sendRequest('configurationDone', res => {

      });
    }
  });

  const server = http.createServer((req, res) => {
    const html = getHtmlFor(path.resolve(__dirname, 'script.js'));
    res.write(html);
    res.end();
  });

  server.listen(PORT, () => {

    console.log(`Serving application on http://localhost:${(server.address()! as AddressInfo).port}/`)

  })

  process.on('exit', () => {
    //server.close();
  });

}

register();

