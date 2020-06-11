
import { DebugSession } from "vscode-debugadapter";
import * as DAP from "./debugprotocol";

import { DEBUGPROTOCOL_DEFAULT_TIMEOUT } from "./constants";

import * as stream from 'stream'
import * as ee from 'events';

interface JsonArray extends Array<Json> { }
interface JsonObject { [key: string]: Json }
type Json = null | boolean | number | string | JsonArray | JsonObject

export class ProtocolClient extends ee.EventEmitter {

    private static TWO_CRLF = '\r\n\r\n';

    private outputStream: stream.Writable | undefined;
    private sequence: number;
    private pendingRequests = new Map<number, (e: DAP.Response) => void>();
    private rawData = new Buffer(0);
    private contentLength: number;

    constructor() {
        super();
        this.sequence = 1;
        this.contentLength = -1;
    }

    protected connect(readable: stream.Readable, writable: stream.Writable): void {

        this.outputStream = writable;

        readable.on('data', (data: Buffer) => {
            this.handleData(data);
        });
    }

    public send(command: DAP.CommandName, args?: any): Promise<DAP.Response> {
        return new Promise((accept, reject) => {
            this.doSend(command, args, result => {
                if (result.success) {
                    accept(result);
                } else {
                    reject(new Error((result as DAP.ErrorResponse).message));
                }
            });
        });
    }

    private doSend(command: string, args: JsonObject, clb: (result: DAP.Response) => void): void {

        const request = {} as DAP.Request;
        request.type = 'request';
        request.seq = this.sequence++;
        request.command = command as DAP.CommandName;
        if (args && Object.keys(args).length > 0) {
            request.arguments = args;
        }

        // store callback for this request
        this.pendingRequests.set(request.seq, clb as (result: DAP.Response) => void);

        const json = JSON.stringify(request);
        this.outputStream!.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`, 'utf8');
    }

    private handleData(data: Buffer): void {

        if (this.outputStream === undefined) {
            throw new Error(`Trying to send a request while the protocol client is not connected.`)
        }

        this.rawData = Buffer.concat([this.rawData, data]);

        while (true) {
            if (this.contentLength >= 0) {
                if (this.rawData.length >= this.contentLength) {
                    const message = this.rawData.toString('utf8', 0, this.contentLength);
                    this.rawData = this.rawData.slice(this.contentLength);
                    this.contentLength = -1;
                    if (message.length > 0) {
                        this.dispatch(message);
                    }
                    continue;	// there may be more complete messages to process
                }
            } else {
                const idx = this.rawData.indexOf(ProtocolClient.TWO_CRLF);
                if (idx !== -1) {
                    const header = this.rawData.toString('utf8', 0, idx);
                    const lines = header.split('\r\n');
                    for (let i = 0; i < lines.length; i++) {
                        const pair = lines[i].split(/: +/);
                        if (pair[0] === 'Content-Length') {
                            this.contentLength = +pair[1];
                        }
                    }
                    this.rawData = this.rawData.slice(idx + ProtocolClient.TWO_CRLF.length);
                    continue;
                }
            }
            break;
        }
    }

    private dispatch(body: string): void {

        const rawData = JSON.parse(body);

        if (typeof rawData.event !== 'undefined') {
            const event = rawData as DAP.Event;
            this.emit(event.event, event);
        } else {
            const response = rawData as DAP.Response;
            const clb = this.pendingRequests.get(response.request_seq);
            if (clb) {
                this.pendingRequests.delete(response.request_seq);
                clb(response);
            }
        }
    }
}

export interface DebugClientOptions {
    timeout?: number;
}

export class DebugClient {

    defaultTimeout: number;

    constructor(private session: DebugSession, options: DebugClientOptions = {}) {
        this.defaultTimeout = options.timeout ?? DEBUGPROTOCOL_DEFAULT_TIMEOUT;
    }

    public sendCustom(command: string, args?: JsonObject): Promise<any> {
        return new Promise((resolve, reject) => {
            this.session.sendRequest(command, args, 100, result => {
                if (result.success) {
                    resolve(result.body);
                } else {
                    reject(new Error(result.message));
                }
            });
        });
    }

    public initialize(args?: DAP.InitializeArguments): Promise<DAP.InitializeResponse> {
        return this.sendCustom('initialize', args as unknown as JsonObject);
    }

    public configurationDone(args?: DAP.ConfigurationDoneArguments): Promise<DAP.ConfigurationDoneResponse> {
        return this.sendCustom('configurationDone', args as unknown as JsonObject);
    }

    public launch(args: DAP.LaunchArguments): Promise<DAP.LaunchResponse> {
        return this.sendCustom('launch', args as unknown as JsonObject);
    }

    public attach(args: DAP.AttachArguments): Promise<DAP.AttachResponse> {
        return this.sendCustom('attach', args as unknown as JsonObject);
    }

    public restart(args: DAP.RestartArguments): Promise<DAP.RestartResponse> {
        return this.sendCustom('restart', args as unknown as JsonObject);
    }

    public terminate(args?: DAP.TerminateArguments): Promise<DAP.TerminateResponse> {
        return this.sendCustom('terminate', args as unknown as JsonObject);
    }

    public disconnect(args?: DAP.DisconnectArguments): Promise<DAP.DisconnectResponse> {
        return this.sendCustom('disconnect', args as unknown as JsonObject);
    }

    public setBreakpoints(args: DAP.SetBreakpointsArguments): Promise<DAP.SetBreakpointsResponse> {
        return this.sendCustom('setBreakpoints', args as unknown as JsonObject);
    }

    public setFunctionBreakpoints(args: DAP.SetFunctionBreakpointsArguments): Promise<DAP.SetFunctionBreakpointsResponse> {
        return this.sendCustom('setFunctionBreakpoints', args as unknown as JsonObject);
    }

    public setExceptionBreakpoints(args: DAP.SetExceptionBreakpointsArguments): Promise<DAP.SetExceptionBreakpointsResponse> {
        return this.sendCustom('setExceptionBreakpoints', args as unknown as JsonObject);
    }

    public dataBreakpointInfo(args: DAP.DataBreakpointInfoArguments): Promise<DAP.DataBreakpointInfoResponse> {
        return this.sendCustom('dataBreakpointInfo', args as unknown as JsonObject);
    }

    public setDataBreakpoints(args: DAP.SetDataBreakpointsArguments): Promise<DAP.SetDataBreakpointsResponse> {
        return this.sendCustom('setDataBreakpoints', args as unknown as JsonObject);
    }

    public continue(args: DAP.ContinueArguments): Promise<DAP.ContinueResponse> {
        return this.sendCustom('continue', args as unknown as JsonObject);
    }

    public next(args: DAP.NextArguments): Promise<DAP.NextResponse> {
        return this.sendCustom('next', args as unknown as JsonObject);


    }

    public stepIn(args: DAP.StepInArguments): Promise<DAP.StepInResponse> {
        return this.sendCustom('stepIn', args as unknown as JsonObject);
    }

    public stepOut(args: DAP.StepOutArguments): Promise<DAP.StepOutResponse> {
        return this.sendCustom('stepOut', args as unknown as JsonObject);
    }

    public stepBack(args: DAP.StepBackArguments): Promise<DAP.StepBackResponse> {
        return this.sendCustom('stepBack', args as unknown as JsonObject);
    }

    public reverseContinue(args: DAP.ReverseContinueArguments): Promise<DAP.ReverseContinueResponse> {
        return this.sendCustom('reverseContinue', args as unknown as JsonObject);
    }

    public restartFrame(args: DAP.RestartFrameArguments): Promise<DAP.RestartFrameResponse> {
        return this.sendCustom('restartFrame', args as unknown as JsonObject);
    }

    public goto(args: DAP.GotoArguments): Promise<DAP.GotoResponse> {
        return this.sendCustom('goto', args as unknown as JsonObject);
    }

    public pause(args: DAP.PauseArguments): Promise<DAP.PauseResponse> {
        return this.sendCustom('pause', args as unknown as JsonObject);
    }

    public stackTrace(args: DAP.StackTraceArguments): Promise<DAP.StackTraceResponse> {
        return this.sendCustom('stackTrace', args as unknown as JsonObject);
    }

    public scopes(args: DAP.ScopesArguments): Promise<DAP.ScopesResponse> {
        return this.sendCustom('scopes', args as unknown as JsonObject);
    }

    public variables(args: DAP.VariablesArguments): Promise<DAP.VariablesResponse> {
        return this.sendCustom('variables', args as unknown as JsonObject);
    }

    public setVariable(args: DAP.SetVariableArguments): Promise<DAP.SetVariableResponse> {
        return this.sendCustom('setVariable', args as unknown as JsonObject);
    }

    public source(args: DAP.SourceArguments): Promise<DAP.SourceResponse> {
        return this.sendCustom('source', args as unknown as JsonObject);
    }

    public threads(): Promise<DAP.ThreadsResponse> {
        return this.sendCustom('threads');
    }

    public modules(args: DAP.ModulesArguments): Promise<DAP.ModulesResponse> {
        return this.sendCustom('modules');
    }

    public evaluate(args: DAP.EvaluateArguments): Promise<DAP.EvaluateResponse> {
        return this.sendCustom('evaluate', args as unknown as JsonObject);
    }

    public stepInTargets(args: DAP.StepInTargetsArguments): Promise<DAP.StepInTargetsResponse> {
        return this.sendCustom('stepInTargets', args as unknown as JsonObject);
    }

    public gotoTargets(args: DAP.GotoTargetsArguments): Promise<DAP.GotoTargetsResponse> {
        return this.sendCustom('gotoTargets', args as unknown as JsonObject);
    }

    public completions(args: DAP.CompletionsArguments): Promise<DAP.CompletionsResponse> {
        return this.sendCustom('completions', args as unknown as JsonObject);
    }

    public exceptionInfo(args: DAP.ExceptionInfoArguments): Promise<DAP.ExceptionInfoResponse> {
        return this.sendCustom('exceptionInfo', args as unknown as JsonObject);
    }

    public waitForEvent(eventType: string, timeout?: number): Promise<DAP.Event> {

        if (timeout === undefined) {
            timeout = this.defaultTimeout;
        }

        return new Promise((resolve, reject) => {
            let timeoutHandler: number;
            const handler = (event: DAP.Event) => {
                clearTimeout(timeoutHandler);
                resolve(event);
            }
            this.session.once(eventType, handler);
            timeoutHandler = setTimeout(() => {
                this.session.removeListener(eventType, handler);
                reject(new Error(`No event '${eventType}' received after ${timeout}ms`));
            }, timeout);
        });

    }

}
