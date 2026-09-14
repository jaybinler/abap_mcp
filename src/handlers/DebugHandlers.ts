import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { formatError } from '../lib/errors.js';

/**
 * SAP ABAP debugger control via the ADT debugging API (ported from
 * mario-andreschak/mcp-abap-abap-adt-api, adapted to local conventions).
 *
 * Typical remote-debugging workflow:
 *   1. debuggerListen — register this MCP terminal as a debug listener for a user
 *   2. debuggerSetBreakpoints — set breakpoints for that user
 *   3. The user (in SAP GUI / another session) triggers the process to be debugged;
 *      the listen call returns the Debuggee
 *   4. debuggerAttach — attach to the debuggee (starts the debug session on this connection)
 *   5. debuggerStackTrace / debuggerVariables / debuggerChildVariables — inspect state
 *   6. debuggerStep — stepInto / stepOver / stepReturn / stepContinue / terminate
 *   7. debuggerGoToStack / debuggerSetVariableValue — navigate frames, tweak values
 *
 * All calls share the server's stateful ADT session, so the debug session started
 * by debuggerAttach persists across tool calls.
 */
export class DebugHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'debuggerListeners',
        annotations: { readOnlyHint: true },
        description:
          'List existing debugger listeners (terminals registered for debugging) for a user. ' +
          'Use to check whether a debug terminal is already registered before calling debuggerListen.',
        inputSchema: {
          type: 'object',
          properties: {
            debuggingMode: { type: 'string', description: 'Debugging mode: "user" or "terminal"' },
            terminalId:    { type: 'string', description: 'Terminal ID (any stable identifier for this MCP terminal)' },
            ideId:         { type: 'string', description: 'IDE ID (any stable identifier, e.g. "zcode-mcp")' },
            user:          { type: 'string', description: 'SAP user whose listeners to list' },
            checkConflict: { type: 'boolean', description: 'Whether to check for conflicting registrations (optional)' }
          },
          required: ['debuggingMode', 'terminalId', 'ideId', 'user']
        }
      },
      {
        name: 'debuggerListen',
        description:
          'Register this terminal as a debug listener for a user. When the user next triggers a ' +
          'debuggable process (e.g. /h or a breakpoint hit in their SAP GUI session), this call ' +
          'returns the Debuggee (session info needed for debuggerAttach). ' +
          'NOTE: this call blocks until a debuggee appears or the request times out — ' +
          'only call it after breakpoints are set and the user is ready to trigger the process.',
        inputSchema: {
          type: 'object',
          properties: {
            debuggingMode:        { type: 'string', description: 'Debugging mode: "user" or "terminal"' },
            terminalId:           { type: 'string', description: 'Terminal ID (any stable identifier for this MCP terminal)' },
            ideId:                { type: 'string', description: 'IDE ID (any stable identifier, e.g. "zcode-mcp")' },
            user:                 { type: 'string', description: 'SAP user whose processes to debug' },
            checkConflict:        { type: 'boolean', description: 'Whether to check for conflicts (optional)' },
            isNotifiedOnConflict: { type: 'boolean', description: 'Whether to be notified on conflict (optional)' }
          },
          required: ['debuggingMode', 'terminalId', 'ideId', 'user']
        }
      },
      {
        name: 'debuggerDeleteListener',
        description:
          'Unregister a debug listener previously created with debuggerListen. ' +
          'Call this to clean up when a debugging session is finished.',
        inputSchema: {
          type: 'object',
          properties: {
            debuggingMode: { type: 'string', description: 'Debugging mode: "user" or "terminal"' },
            terminalId:    { type: 'string', description: 'Terminal ID used in debuggerListen' },
            ideId:         { type: 'string', description: 'IDE ID used in debuggerListen' },
            user:          { type: 'string', description: 'SAP user the listener was registered for' }
          },
          required: ['debuggingMode', 'terminalId', 'ideId', 'user']
        }
      },
      {
        name: 'debuggerSetBreakpoints',
        description:
          'Set breakpoints for a user. Each entry is either a DebugBreakpoint object (round-trip from a ' +
          'previous call, supports a "condition") or a source URI string. ' +
          'Returns the created breakpoints (keep them for debuggerDeleteBreakpoints).',
        inputSchema: {
          type: 'object',
          properties: {
            debuggingMode:   { type: 'string', description: 'Debugging mode: "user" or "terminal"' },
            terminalId:      { type: 'string', description: 'Terminal ID used in debuggerListen' },
            ideId:           { type: 'string', description: 'IDE ID used in debuggerListen' },
            clientId:        { type: 'string', description: 'Client ID for the breakpoints, e.g. the terminalId' },
            breakpoints:     { type: 'array', description: 'Array of breakpoint objects or source URI strings' },
            user:            { type: 'string', description: 'SAP user to set breakpoints for' },
            scope:           { type: 'string', description: '"external" or "debugger" (optional)' },
            systemDebugging: { type: 'boolean', description: 'Also debug system code (optional)' },
            deactivated:     { type: 'boolean', description: 'Create breakpoints in deactivated state (optional)' },
            syncScupeUrl:    { type: 'string', description: 'Sync scope URI (optional)' }
          },
          required: ['debuggingMode', 'terminalId', 'ideId', 'clientId', 'breakpoints', 'user']
        }
      },
      {
        name: 'debuggerDeleteBreakpoints',
        description:
          'Delete breakpoints previously created with debuggerSetBreakpoints. ' +
          'Pass one of the breakpoint objects returned by that call.',
        inputSchema: {
          type: 'object',
          properties: {
            breakpoint:     { type: 'object', description: 'Breakpoint object returned by debuggerSetBreakpoints' },
            debuggingMode:  { type: 'string', description: 'Debugging mode: "user" or "terminal"' },
            terminalId:     { type: 'string', description: 'Terminal ID used in debuggerListen' },
            ideId:          { type: 'string', description: 'IDE ID used in debuggerListen' },
            requestUser:    { type: 'string', description: 'SAP user the breakpoints belong to' },
            scope:          { type: 'string', description: '"external" or "debugger" (optional)' }
          },
          required: ['breakpoint', 'debuggingMode', 'terminalId', 'ideId', 'requestUser']
        }
      },
      {
        name: 'debuggerAttach',
        description:
          'Attach the debugger to a debuggee returned by debuggerListen. ' +
          'This starts the actual debug session on this connection — afterwards use ' +
          'debuggerStackTrace, debuggerVariables and debuggerStep to control it.',
        inputSchema: {
          type: 'object',
          properties: {
            debuggingMode:   { type: 'string', description: 'Debugging mode: "user" or "terminal"' },
            debuggeeId:      { type: 'string', description: 'Debuggee ID from the debuggerListen result' },
            user:            { type: 'string', description: 'SAP user being debugged' },
            dynproDebugging: { type: 'boolean', description: 'Enable dynpro debugging (optional)' }
          },
          required: ['debuggingMode', 'debuggeeId', 'user']
        }
      },
      {
        name: 'debuggerSaveSettings',
        description:
          'Save debugger settings (e.g. default settings for the debug session). Returns the effective settings.',
        inputSchema: {
          type: 'object',
          properties: {
            settings: { type: 'object', description: 'Partial DebugSettings object to persist' }
          },
          required: ['settings']
        }
      },
      {
        name: 'debuggerStackTrace',
        annotations: { readOnlyHint: true },
        description:
          'Get the call stack of the attached debug session. Requires debuggerAttach first. ' +
          'Each frame shows type, name, URI and line — use the frame position or URI with debuggerGoToStack.',
        inputSchema: {
          type: 'object',
          properties: {
            semanticURIs: { type: 'boolean', description: 'Return semantic URIs (optional)' }
          }
        }
      },
      {
        name: 'debuggerVariables',
        annotations: { readOnlyHint: true },
        description:
          'Get the variables visible in the current stack frame of the attached debug session. ' +
          'For structured variables, follow up with debuggerChildVariables using the returned parent name.',
        inputSchema: {
          type: 'object',
          properties: {
            parents: { type: 'array', items: { type: 'string' }, description: 'Parent variable names (empty array = top level)' }
          },
          required: ['parents']
        }
      },
      {
        name: 'debuggerChildVariables',
        annotations: { readOnlyHint: true },
        description:
          'Get the child variables of a structured variable in the debug session (e.g. components of a structure, rows of a table).',
        inputSchema: {
          type: 'object',
          properties: {
            parent: { type: 'array', items: { type: 'string' }, description: 'Path of the parent variable, e.g. ["LS_DATA", "HEADER"]' }
          },
          required: ['parent']
        }
      },
      {
        name: 'debuggerStep',
        description:
          'Step the attached debug session: stepInto, stepOver, stepReturn, stepContinue, or terminateDebuggee. ' +
          'stepRunToLine / stepJumpToLine additionally require the target source url.',
        inputSchema: {
          type: 'object',
          properties: {
            steptype: { type: 'string', description: 'One of: stepInto, stepOver, stepReturn, stepContinue, terminateDebuggee, stepRunToLine, stepJumpToLine' },
            url:      { type: 'string', description: 'Source URL (required only for stepRunToLine / stepJumpToLine)' }
          },
          required: ['steptype']
        }
      },
      {
        name: 'debuggerGoToStack',
        description:
          'Switch the debug session to another stack frame (by frame position number or frame URI). ' +
          'Afterwards debuggerVariables shows that frame\'s variables.',
        inputSchema: {
          type: 'object',
          properties: {
            urlOrPosition: { type: 'string', description: 'Frame position (number as string) or frame URI from debuggerStackTrace' }
          },
          required: ['urlOrPosition']
        }
      },
      {
        name: 'debuggerSetVariableValue',
        description:
          'Change the value of a variable in the current frame of the attached debug session. ' +
          'Value is passed as its external (string) representation. Returns the new value.',
        inputSchema: {
          type: 'object',
          properties: {
            variableName: { type: 'string', description: 'Variable name in the current frame' },
            value:        { type: 'string', description: 'New value (external string representation)' }
          },
          required: ['variableName', 'value']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'debuggerListeners':       return this.handleListeners(args);
      case 'debuggerListen':          return this.handleListen(args);
      case 'debuggerDeleteListener':  return this.handleDeleteListener(args);
      case 'debuggerSetBreakpoints':  return this.handleSetBreakpoints(args);
      case 'debuggerDeleteBreakpoints': return this.handleDeleteBreakpoints(args);
      case 'debuggerAttach':          return this.handleAttach(args);
      case 'debuggerSaveSettings':    return this.handleSaveSettings(args);
      case 'debuggerStackTrace':      return this.handleStackTrace(args);
      case 'debuggerVariables':       return this.handleVariables(args);
      case 'debuggerChildVariables':  return this.handleChildVariables(args);
      case 'debuggerStep':            return this.handleStep(args);
      case 'debuggerGoToStack':       return this.handleGoToStack(args);
      case 'debuggerSetVariableValue': return this.handleSetVariableValue(args);
      default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }
  }

  private async handleListeners(args: any): Promise<any> {
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerListeners(
          args.debuggingMode, args.terminalId, args.ideId, args.user, args.checkConflict
        )
      );
      return this.success({ result: result ?? null });
    } catch (error: any) {
      this.fail(formatError('debuggerListeners', error));
    }
  }

  private async handleListen(args: any): Promise<any> {
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerListen(
          args.debuggingMode, args.terminalId, args.ideId, args.user,
          args.checkConflict, args.isNotifiedOnConflict
        )
      );
      return this.success({ result: result ?? null });
    } catch (error: any) {
      this.fail(formatError('debuggerListen', error));
    }
  }

  private async handleDeleteListener(args: any): Promise<any> {
    try {
      await this.withSession(() =>
        this.adtclient.debuggerDeleteListener(args.debuggingMode, args.terminalId, args.ideId, args.user)
      );
      return this.success({ message: `Debug listener ${args.ideId}/${args.terminalId} deleted for ${args.user}.` });
    } catch (error: any) {
      this.fail(formatError('debuggerDeleteListener', error));
    }
  }

  private async handleSetBreakpoints(args: any): Promise<any> {
    if (!Array.isArray(args.breakpoints)) {
      this.fail('debuggerSetBreakpoints requires "breakpoints" to be an array.');
    }
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerSetBreakpoints(
          args.debuggingMode, args.terminalId, args.ideId, args.clientId,
          args.breakpoints, args.user, args.scope, args.systemDebugging,
          args.deactivated, args.syncScupeUrl
        )
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerSetBreakpoints', error));
    }
  }

  private async handleDeleteBreakpoints(args: any): Promise<any> {
    if (!args.breakpoint) this.fail('debuggerDeleteBreakpoints requires "breakpoint".');
    try {
      await this.withSession(() =>
        this.adtclient.debuggerDeleteBreakpoints(
          args.breakpoint, args.debuggingMode, args.terminalId, args.ideId, args.requestUser, args.scope
        )
      );
      return this.success({ message: 'Breakpoint deleted.' });
    } catch (error: any) {
      this.fail(formatError('debuggerDeleteBreakpoints', error));
    }
  }

  private async handleAttach(args: any): Promise<any> {
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerAttach(args.debuggingMode, args.debuggeeId, args.user, args.dynproDebugging)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerAttach', error));
    }
  }

  private async handleSaveSettings(args: any): Promise<any> {
    if (!args.settings || typeof args.settings !== 'object') {
      this.fail('debuggerSaveSettings requires "settings" object.');
    }
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerSaveSettings(args.settings)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerSaveSettings', error));
    }
  }

  private async handleStackTrace(args: any): Promise<any> {
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerStackTrace(args.semanticURIs)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerStackTrace', error));
    }
  }

  private async handleVariables(args: any): Promise<any> {
    try {
      const parents: string[] = Array.isArray(args.parents) ? args.parents : [];
      const result = await this.withSession(() =>
        this.adtclient.debuggerVariables(parents)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerVariables', error));
    }
  }

  private async handleChildVariables(args: any): Promise<any> {
    try {
      const parent: string[] = Array.isArray(args.parent) ? args.parent : [];
      const result = await this.withSession(() =>
        this.adtclient.debuggerChildVariables(parent)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerChildVariables', error));
    }
  }

  private async handleStep(args: any): Promise<any> {
    const valid = ['stepInto', 'stepOver', 'stepReturn', 'stepContinue', 'terminateDebuggee', 'stepRunToLine', 'stepJumpToLine'];
    if (!valid.includes(args.steptype)) {
      this.fail(`debuggerStep: steptype must be one of ${valid.join(', ')}.`);
    }
    if ((args.steptype === 'stepRunToLine' || args.steptype === 'stepJumpToLine') && !args.url) {
      this.fail(`debuggerStep: ${args.steptype} requires "url".`);
    }
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerStep(args.steptype, args.url)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerStep', error));
    }
  }

  private async handleGoToStack(args: any): Promise<any> {
    if (args.urlOrPosition === undefined || args.urlOrPosition === null) {
      this.fail('debuggerGoToStack requires "urlOrPosition".');
    }
    const pos = Number(args.urlOrPosition);
    try {
      await this.withSession(() =>
        this.adtclient.debuggerGoToStack(Number.isNaN(pos) ? String(args.urlOrPosition) : pos)
      );
      return this.success({ message: `Switched to stack frame ${args.urlOrPosition}.` });
    } catch (error: any) {
      this.fail(formatError('debuggerGoToStack', error));
    }
  }

  private async handleSetVariableValue(args: any): Promise<any> {
    if (!args.variableName || args.value === undefined) {
      this.fail('debuggerSetVariableValue requires "variableName" and "value".');
    }
    try {
      const result = await this.withSession(() =>
        this.adtclient.debuggerSetVariableValue(args.variableName, String(args.value))
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('debuggerSetVariableValue', error));
    }
  }
}
