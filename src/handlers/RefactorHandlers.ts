import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';
import { formatError } from '../lib/errors.js';
import type { Range, ExtractMethodProposal, GenericRefactoring, RenameRefactoringProposal, RenameRefactoring } from 'abap-adt-api';

/**
 * ABAP refactoring operations (rename + extract method) via the ADT refactoring
 * API (ported from mario-andreschak/mcp-abap-abap-adt-api, adapted to local conventions).
 *
 * Workflow — rename:
 *   1. renameEvaluate(uri, line, startColumn, endColumn) on the symbol → proposal
 *   2. renamePreview(proposal, transport?) → shows affected objects/deltas
 *   3. renameExecute(refactoring from preview) → applies the change
 *
 * Workflow — extract method:
 *   1. extractMethodEvaluate(uri, range) on the selected lines → proposal
 *   2. extractMethodPreview(proposal) → shows the generated method + call sites
 *   3. extractMethodExecute(refactoring from preview) → applies the change
 *
 * The uri is the object's SOURCE url (e.g. /sap/bc/adt/oo/classes/zcl_x/source/main).
 * Object/complex parameters may be passed as objects or as JSON strings.
 */
export class RefactorHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'renameEvaluate',
        annotations: { readOnlyHint: true },
        description:
          'Evaluate a rename refactoring at a cursor position: returns a RenameRefactoringProposal ' +
          'describing the symbol and proposed new name. Pass the proposal to renamePreview. ' +
          'uri is the object source URL (…/source/main); line/column locate the symbol (1-based line).',
        inputSchema: {
          type: 'object',
          properties: {
            uri:         { type: 'string', description: 'Source URL of the object, e.g. /sap/bc/adt/oo/classes/zcl_foo/source/main' },
            line:        { type: 'number', description: 'Line number of the symbol' },
            startColumn: { type: 'number', description: 'Start column of the symbol' },
            endColumn:   { type: 'number', description: 'End column of the symbol' }
          },
          required: ['uri', 'line', 'startColumn', 'endColumn']
        }
      },
      {
        name: 'renamePreview',
        annotations: { readOnlyHint: true },
        description:
          'Preview a rename refactoring: pass the proposal from renameEvaluate (optionally change its ' +
          'new name first) and a transport number. Returns the RenameRefactoring with all affected ' +
          'objects and their deltas. Pass that result to renameExecute to apply.',
        inputSchema: {
          type: 'object',
          properties: {
            renameRefactoring: { type: 'object', description: 'RenameRefactoringProposal returned by renameEvaluate (object or JSON string)' },
            transport:         { type: 'string', description: 'Transport request number (optional)' }
          },
          required: ['renameRefactoring']
        }
      },
      {
        name: 'renameExecute',
        annotations: { destructiveHint: true },
        description:
          'Execute a rename refactoring: pass the RenameRefactoring returned by renamePreview. ' +
          'Renames the symbol across ALL affected objects (where-used) in one atomic operation.',
        inputSchema: {
          type: 'object',
          properties: {
            refactoring: { type: 'object', description: 'RenameRefactoring returned by renamePreview (object or JSON string)' }
          },
          required: ['refactoring']
        }
      },
      {
        name: 'extractMethodEvaluate',
        annotations: { readOnlyHint: true },
        description:
          'Evaluate an extract-method refactoring for a source range: returns an ExtractMethodProposal. ' +
          'uri is the object source URL (…/source/main); range is {"start":{"line":N,"column":N},"end":{"line":N,"column":N}}.',
        inputSchema: {
          type: 'object',
          properties: {
            uri:   { type: 'string', description: 'Source URL of the object, e.g. /sap/bc/adt/programs/programs/zprog/source/main' },
            range: { type: 'object', description: 'Range to extract: {"start":{"line":1,"column":0},"end":{"line":5,"column":10}} (object or JSON string)' }
          },
          required: ['uri', 'range']
        }
      },
      {
        name: 'extractMethodPreview',
        annotations: { readOnlyHint: true },
        description:
          'Preview an extract-method refactoring: pass the proposal from extractMethodEvaluate. ' +
          'Returns the GenericRefactoring showing the new method and the replaced call site. ' +
          'Pass that result to extractMethodExecute to apply.',
        inputSchema: {
          type: 'object',
          properties: {
            proposal: { type: 'object', description: 'ExtractMethodProposal returned by extractMethodEvaluate (object or JSON string)' }
          },
          required: ['proposal']
        }
      },
      {
        name: 'extractMethodExecute',
        annotations: { destructiveHint: true },
        description:
          'Execute an extract-method refactoring: pass the GenericRefactoring returned by extractMethodPreview. ' +
          'Creates the new method and replaces the selected range with a call to it.',
        inputSchema: {
          type: 'object',
          properties: {
            refactoring: { type: 'object', description: 'GenericRefactoring returned by extractMethodPreview (object or JSON string)' }
          },
          required: ['refactoring']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'renameEvaluate':         return this.handleRenameEvaluate(args);
      case 'renamePreview':          return this.handleRenamePreview(args);
      case 'renameExecute':          return this.handleRenameExecute(args);
      case 'extractMethodEvaluate':  return this.handleExtractEvaluate(args);
      case 'extractMethodPreview':   return this.handleExtractPreview(args);
      case 'extractMethodExecute':   return this.handleExtractExecute(args);
      default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }
  }

  // Schemas declare complex params as objects, but tolerate JSON strings too
  private parseObjectArg<T>(value: unknown, name: string): T {
    if (typeof value !== 'string') return value as T;
    try {
      return JSON.parse(value) as T;
    } catch {
      this.fail(`Parameter '${name}' is not valid JSON.`);
    }
  }

  private async handleRenameEvaluate(args: any): Promise<any> {
    if (!args.uri || args.line === undefined || args.startColumn === undefined || args.endColumn === undefined) {
      this.fail('renameEvaluate requires uri, line, startColumn, endColumn.');
    }
    try {
      const result = await this.withSession(() =>
        this.adtclient.renameEvaluate(args.uri, Number(args.line), Number(args.startColumn), Number(args.endColumn))
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('renameEvaluate', error));
    }
  }

  private async handleRenamePreview(args: any): Promise<any> {
    if (!args.renameRefactoring) this.fail('renamePreview requires "renameRefactoring".');
    try {
      const proposal = this.parseObjectArg<RenameRefactoringProposal>(args.renameRefactoring, 'renameRefactoring');
      const result = await this.withSession(() =>
        this.adtclient.renamePreview(proposal, args.transport)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('renamePreview', error));
    }
  }

  private async handleRenameExecute(args: any): Promise<any> {
    if (!args.refactoring) this.fail('renameExecute requires "refactoring".');
    try {
      const refactoring = this.parseObjectArg<RenameRefactoring>(args.refactoring, 'refactoring');
      const result = await this.withSession(() =>
        this.adtclient.renameExecute(refactoring)
      );
      return this.success({ result, message: 'Rename applied. Activate the affected objects to finish.' });
    } catch (error: any) {
      this.fail(formatError('renameExecute', error));
    }
  }

  private async handleExtractEvaluate(args: any): Promise<any> {
    if (!args.uri || !args.range) this.fail('extractMethodEvaluate requires "uri" and "range".');
    try {
      const range = this.parseObjectArg<Range>(args.range, 'range');
      const result = await this.withSession(() =>
        this.adtclient.extractMethodEvaluate(args.uri, range)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('extractMethodEvaluate', error));
    }
  }

  private async handleExtractPreview(args: any): Promise<any> {
    if (!args.proposal) this.fail('extractMethodPreview requires "proposal".');
    try {
      const proposal = this.parseObjectArg<ExtractMethodProposal>(args.proposal, 'proposal');
      const result = await this.withSession(() =>
        this.adtclient.extractMethodPreview(proposal)
      );
      return this.success({ result });
    } catch (error: any) {
      this.fail(formatError('extractMethodPreview', error));
    }
  }

  private async handleExtractExecute(args: any): Promise<any> {
    if (!args.refactoring) this.fail('extractMethodExecute requires "refactoring".');
    try {
      const refactoring = this.parseObjectArg<GenericRefactoring>(args.refactoring, 'refactoring');
      const result = await this.withSession(() =>
        this.adtclient.extractMethodExecute(refactoring)
      );
      return this.success({ result, message: 'Extract method applied. Activate the object to finish.' });
    } catch (error: any) {
      this.fail(formatError('extractMethodExecute', error));
    }
  }
}
