import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './BaseHandler.js';
import { session_types } from 'abap-adt-api';
import type { ToolDefinition } from '../types/tools.js';
import { formatError } from '../lib/errors.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export class RfcHandlers extends BaseHandler {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'abap_rfc_call',
        description:
          'Call an RFC-enabled function module on the SAP system directly via SAP NW RFC protocol. ' +
          'Uses Python pyrfc library to establish an RFC connection and call the function module. ' +
          'Supports IMPORT parameters (scalars) and TABLE parameters (internal tables). ' +
          'Returns the function module output including EXPORT and TABLE parameters. ' +
          'Connection parameters are auto-detected from the MCP server configuration.',
        inputSchema: {
          type: 'object',
          properties: {
            functionName: {
              type: 'string',
              description: 'Name of the RFC function module to call, e.g. ZMCP_DDIC_CREATE'
            },
            importingParams: {
              type: 'object',
              description: 'IMPORT parameters as key-value pairs. Keys are parameter names, values are scalar values. ' +
                'Example: { "IV_OBJNAME": "ZS_TEST", "IV_OBJTYPE": "STRU" }'
            },
            tableParams: {
              type: 'object',
              description: 'TABLE parameters. Keys are parameter names, values are arrays of row objects. ' +
                'Example: { "IT_FIELDS": [ { "FIELDNAME": "MJAHR", "POSITION": "0001" } ] }'
            },
            ashost: {
              type: 'string',
              description: 'SAP application server host (auto-detected from MCP config if omitted)'
            },
            sysnr: {
              type: 'string',
              description: 'SAP system number (default: "00")'
            },
            client: {
              type: 'string',
              description: 'SAP client (auto-detected from MCP config if omitted)'
            }
          },
          required: ['functionName']
        }
      },
      {
        name: 'abap_ddic_create',
        description:
          'Create a DDIC structure or table on the SAP system via RFC. ' +
          'Calls function module ZFM_DDIC_CREATE which uses DDIF_TABL_PUT and DDIF_TABL_ACTIVATE. ' +
          'Automatically derives DATATYPE, LENG, DECIMALS from data elements (ROLLNAME). ' +
          'Creates DD02T entries for both the specified language and system language (1). ' +
          'Requires ZFM_DDIC_CREATE to be installed and RFC-enabled on the target system.',
        annotations: {
          destructiveHint: true,
          title: 'Create DDIC Structure/Table',
        },
        inputSchema: {
          type: 'object',
          properties: {
            objectName: {
              type: 'string',
              description: 'DDIC object name, e.g. ZS_TEST or ZTAB_BUKRS'
            },
            objectType: {
              type: 'string',
              description: 'Object type: STRU (structure) or TABL (transparent table)',
              enum: ['STRU', 'TABL']
            },
            description: {
              type: 'string',
              description: 'Short description (max 10 chars due to ZMCP_OBJ_TYPE limitation)'
            },
            language: {
              type: 'string',
              description: 'Language key (default: E)',
              optional: true
            },
            fields: {
              type: 'array',
              description: 'Field definitions. Each field needs FIELDNAME and ROLLNAME (data element). ' +
                'POSITION is auto-assigned if omitted. DDLANGUAGE defaults to the specified language.',
              optional: true
            },
            ashost: {
              type: 'string',
              description: 'SAP application server host (auto-detected from MCP config if omitted)',
              optional: true
            },
            sysnr: {
              type: 'string',
              description: 'SAP system number (default: "00")',
              optional: true
            },
            client: {
              type: 'string',
              description: 'SAP client (auto-detected from MCP config if omitted)',
              optional: true
            }
          },
          required: ['objectName', 'objectType', 'fields']
        }
      }
    ];
  }

  async handle(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'abap_rfc_call': return this.handleRfcCall(args);
      case 'abap_ddic_create': return this.handleDdicCreate(args);
      default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }
  }

  /**
   * Get RFC connection parameters from the ADT client configuration.
   */
  private getConnectionParams(args: any): Record<string, string> {
    // Get connection info from ADT client
    const h = (this.adtclient as any).h;
    const baseUrl: string = h?.baseUrl || h?.url || '';
    const username: string = h?.username || '';
    const password: string = h?.password || '';

    // Extract host from URL (e.g. https://your-sap-host:44300 → your-sap-host)
    let host = args.ashost || '';
    if (!host && baseUrl) {
      try {
        const url = new URL(baseUrl);
        host = url.hostname;
      } catch (_) {
        // Fallback: extract from URL string
        const match = baseUrl.match(/https?:\/\/([^:\/]+)/);
        if (match) host = match[1];
      }
    }

    return {
      ashost: host || process.env.SAP_ASHOST || '',
      sysnr: args.sysnr || process.env.SAP_SYSNR || '00',
      client: args.client || process.env.SAP_CLIENT || '100',
      user: username,
      passwd: password,
    };
  }

  /**
   * Find the Python rfc_call.py script path.
   */
  private findPythonScript(): string {
    const scriptCandidates = [
      path.join(process.cwd(), 'scripts', 'rfc_call.py'),
      path.join(__dirname, '..', '..', 'scripts', 'rfc_call.py'),
      path.join(path.dirname(process.argv[1] || ''), '..', 'scripts', 'rfc_call.py'),
    ];

    for (const candidate of scriptCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return '';
  }

  /**
   * Execute a Python pyrfc call and return the parsed result.
   */
  private async executeRfcCall(inputJson: string, timeoutMs: number = 60000): Promise<any> {
    const scriptPath = this.findPythonScript();
    if (!scriptPath) {
      this.fail(
        'Python script rfc_call.py not found. ' +
        'Expected in scripts/ directory relative to the MCP server.'
      );
    }

    const { stdout } = await execFileAsync(
      'python',
      [scriptPath, '--json', inputJson],
      {
        timeout: timeoutMs,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return JSON.parse(stdout.trim());
  }

  private async handleRfcCall(args: any): Promise<any> {
    const functionName = (args.functionName || '').toUpperCase();
    if (!functionName) {
      this.fail('abap_rfc_call: functionName is required.');
    }

    const importingParams = args.importingParams || {};
    const tableParams = args.tableParams || {};

    // Get connection parameters
    const connParams = this.getConnectionParams(args);

    if (!connParams.ashost || !connParams.user || !connParams.passwd) {
      this.fail(
        'abap_rfc_call: Could not auto-detect SAP connection parameters. ' +
        'Provide ashost explicitly or check MCP server configuration.'
      );
    }

    // Build input JSON for Python script
    const inputJson = JSON.stringify({
      connection: connParams,
      function: functionName,
      params: importingParams,
      tables: tableParams,
    });

    await this.notify(`Calling RFC function ${functionName} via Python pyrfc...`);

    try {
      const result = await this.executeRfcCall(inputJson);

      if (result.success) {
        await this.notify(`RFC call to ${functionName} completed successfully.`);
        return this.success({
          functionName,
          result: result.result,
          connectionParams: {
            host: connParams.ashost,
            sysnr: connParams.sysnr,
            client: connParams.client,
            user: connParams.user,
          },
        });
      } else {
        this.fail(`RFC call to ${functionName} failed: ${result.error}`);
      }

    } catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        this.fail(`RFC call to ${functionName} timed out after 60 seconds.`);
      }

      const stderr = error.stderr || '';
      const stdout = error.stdout || '';

      if (stdout) {
        try {
          const result = JSON.parse(stdout.trim());
          if (!result.success) {
            this.fail(`RFC call failed: ${result.error}`);
          }
        } catch (_) {}
      }

      this.fail(
        `RFC call to ${functionName} failed: ${error.message}\n` +
        (stderr ? `Python stderr: ${stderr.slice(0, 500)}` : '')
      );
    }
  }

  private async handleDdicCreate(args: any): Promise<any> {
    const objectName = (args.objectName || '').toUpperCase();
    const objectType = (args.objectType || '').toUpperCase();
    const description = args.description || '';
    const language = args.language || 'E';
    const fields = args.fields || [];

    if (!objectName) {
      this.fail('abap_ddic_create: objectName is required.');
    }
    if (!objectType || !['STRU', 'TABL'].includes(objectType)) {
      this.fail('abap_ddic_create: objectType must be STRU or TABL.');
    }
    if (!fields || fields.length === 0) {
      this.fail('abap_ddic_create: fields array is required and must not be empty.');
    }

    // Build IT_FIELDS table for the FM
    const itFields = fields.map((f: any, index: number) => ({
      FIELDNAME: (f.FIELDNAME || f.fieldname || '').toUpperCase(),
      ROLLNAME: (f.ROLLNAME || f.rollname || '').toUpperCase(),
      POSITION: (f.POSITION || f.position || String(index + 1).padStart(4, '0')),
      DDLANGUAGE: (f.DDLANGUAGE || f.ddlanguage || language),
    }));

    // Validate fields
    for (const f of itFields) {
      if (!f.FIELDNAME) {
        this.fail('abap_ddic_create: each field must have FIELDNAME.');
      }
      if (!f.ROLLNAME) {
        this.fail(`abap_ddic_create: field ${f.FIELDNAME} must have ROLLNAME (data element).`);
      }
    }

    // Get connection parameters
    const connParams = this.getConnectionParams(args);
    if (!connParams.ashost || !connParams.user || !connParams.passwd) {
      this.fail(
        'abap_ddic_create: Could not auto-detect SAP connection parameters. ' +
        'Provide ashost explicitly or check MCP server configuration.'
      );
    }

    // Build input JSON for Python script
    const inputJson = JSON.stringify({
      connection: connParams,
      function: 'ZFM_DDIC_CREATE',
      params: {
        IV_OBJNAME: objectName,
        IV_OBJTYPE: objectType,
        IV_DESCRIPTION: description,
        IV_LANGUAGE: language,
      },
      tables: {
        IT_FIELDS: itFields,
      },
    });

    await this.notify(`Creating ${objectType === 'STRU' ? 'structure' : 'table'} ${objectName} via RFC...`);

    try {
      const result = await this.executeRfcCall(inputJson, 120000);

      if (result.success) {
        const evRc = result.result?.EV_RC;
        const evMessage = result.result?.EV_MESSAGE || '';

        if (evRc === 0) {
          await this.notify(`${objectType} ${objectName} created and activated successfully.`);
          return this.success({
            objectName,
            objectType,
            rc: evRc,
            message: evMessage,
            fields: itFields.map((f: any) => ({
              FIELDNAME: f.FIELDNAME,
              ROLLNAME: f.ROLLNAME,
              POSITION: f.POSITION,
            })),
          });
        } else {
          // FM ran but returned an error
          this.fail(
            `DDIC creation of ${objectName} failed: RC=${evRc}, Message=${evMessage}`
          );
        }
      } else {
        this.fail(`DDIC creation of ${objectName} failed: ${result.error}`);
      }

    } catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        this.fail(`DDIC creation of ${objectName} timed out after 120 seconds.`);
      }

      const stderr = error.stderr || '';
      const stdout = error.stdout || '';

      if (stdout) {
        try {
          const result = JSON.parse(stdout.trim());
          if (!result.success) {
            this.fail(`DDIC creation failed: ${result.error}`);
          }
        } catch (_) {}
      }

      this.fail(
        `DDIC creation of ${objectName} failed: ${error.message}\n` +
        (stderr ? `Python stderr: ${stderr.slice(0, 500)}` : '')
      );
    }
  }
}
