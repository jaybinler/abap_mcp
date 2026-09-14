/**
 * SAP_BASIS 731 Compatibility Layer
 *
 * SAP ECC 6.0 (SAP_BASIS 731) has different ADT API requirements than newer S/4HANA systems.
 * This module provides compatibility methods that work on older SAP systems.
 *
 * Key differences on SAP_BASIS 731:
 * 1. Content-Type must NOT include version numbers (e.g. v1, v2)
 * 2. ADT operations use RFC function SADT_REST_RFC_ENDPOINT instead of direct HTTP
 * 3. Transport creation uses different XML format
 */

import type { ADTClient } from 'abap-adt-api';

export interface SapBasisInfo {
  version: number;
  isLegacy: boolean;  // true if SAP_BASIS <= 731
  release: string;
}

/**
 * RFC Proxy client for transport operations on SAP_BASIS 731
 * Supports multiple SAP servers via server_id parameter
 */
class RfcProxyClient {
  private proxyUrl: string;
  private enabled: boolean;

  constructor() {
    this.proxyUrl = process.env.RFC_PROXY_URL || 'http://127.0.0.1:5101';
    this.enabled = (process.env.RFC_PROXY_ENABLED || 'true').toLowerCase() === 'true';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get list of available servers from RFC proxy
   */
  async getServers(): Promise<{
    success: boolean;
    servers?: Array<{ id: string; description: string }>;
    default_server?: string;
    error?: string;
  }> {
    if (!this.enabled) {
      return { success: false, error: 'RFC proxy is disabled' };
    }

    try {
      const response = await fetch(`${this.proxyUrl}/servers`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      const data = await response.json() as {
        success: boolean;
        servers?: Array<{ id: string; description: string }>;
        default_server?: string;
        error?: string;
      };
      return data;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create transport request
   * @param devclass Package name
   * @param description Transport description
   * @param refUri Reference object URI
   * @param server_id SAP server identifier (e.g., "DEV", "QAS")
   */
  async createTransport(
    devclass: string,
    description: string,
    refUri?: string,
    server_id?: string
  ): Promise<{
    success: boolean;
    transport?: string;
    description?: string;
    error?: string;
  }> {
    if (!this.enabled) {
      return { success: false, error: 'RFC proxy is disabled' };
    }

    try {
      const response = await fetch(`${this.proxyUrl}/transport/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devclass,
          description,
          ref_uri: refUri,
          server_id
        })
      });

      const data = await response.json() as {
        success: boolean;
        transport?: string;
        description?: string;
        error?: string;
      };
      return data;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Set transport request description
   * @param transport Transport request number
   * @param description New description
   * @param server_id SAP server identifier
   */
  async setTransportDescription(
    transport: string,
    description: string,
    server_id?: string
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.enabled) {
      return { success: false, error: 'RFC proxy is disabled' };
    }

    try {
      const response = await fetch(`${this.proxyUrl}/transport/set-desc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transport,
          description,
          server_id
        })
      });

      const data = await response.json() as { success: boolean; error?: string };
      return data;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Check transport requirements
   * @param objectUri Object URI
   * @param devclass Package name
   * @param operation Operation type
   * @param server_id SAP server identifier
   */
  async checkTransport(
    objectUri: string,
    devclass: string,
    operation: string,
    server_id?: string
  ): Promise<any> {
    if (!this.enabled) {
      return { success: false, error: 'RFC proxy is disabled' };
    }

    try {
      const response = await fetch(`${this.proxyUrl}/transport/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object_uri: objectUri,
          devclass,
          operation,
          server_id
        })
      });

      const data = await response.json();
      return data;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Global RFC proxy client instance
const rfcProxy = new RfcProxyClient();

/**
 * Get the RFC proxy client
 */
export function getRfcProxy(): RfcProxyClient {
  return rfcProxy;
}

/**
 * Get SAP_BASIS version from the system
 */
export async function getSapBasisVersion(client: ADTClient): Promise<SapBasisInfo> {
  try {
    const h = (client as any).h;

    // Method 1: Query CVERS table directly via ADT SQL endpoint
    try {
      const sqlResponse = await h.request('/sap/bc/adt/repository/informationsystem/programs/program', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml'
        },
        qs: { operation: 'SQL_QUERY' },
        body: `<?xml version="1.0" encoding="UTF-8"?><sql:query xmlns:sql="http://www.sap.com/adt/repository/informationsystem/sql">SELECT COMPONENT, RELEASE FROM CVERS WHERE COMPONENT = 'SAP_BASIS'</sql:query>`
      }).catch(() => null);

      if (sqlResponse?.body) {
        const match = sqlResponse.body.match(/RELEASE[^>]*>([^<]+)</);
        if (match && match[1]) {
          const release = match[1].trim();
          const version = parseReleaseToVersion(release);
          return { version, isLegacy: version <= 731, release };
        }
      }
    } catch (_) {}

    // Method 2: Use ADT client's tableContents method if available
    try {
      const tableResult = await (client as any).tableContents?.('CVERS', 10, false,
        "SELECT COMPONENT, RELEASE FROM CVERS WHERE COMPONENT = 'SAP_BASIS'"
      );

      if (tableResult?.values?.length > 0) {
        const row = tableResult.values[0];
        const release = row.RELEASE || row.release || row[1] || '';
        const version = parseReleaseToVersion(release);
        return { version, isLegacy: version <= 731, release };
      }
    } catch (_) {}

    // Method 3: Query via raw SQL endpoint (works on most systems)
    try {
      const rawResponse = await h.request('/sap/bc/adt/repository/informationsystem/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.tools.repository.informationsystem.query',
          'Accept': 'application/vnd.sap.as+xml;charset=UTF-8'
        },
        body: `<?xml version="1.0" encoding="UTF-8"?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><QUERY>SELECT COMPONENT, RELEASE FROM CVERS WHERE COMPONENT = 'SAP_BASIS'</QUERY></DATA></asx:values></asx:abap>`
      }).catch(() => null);

      if (rawResponse?.body) {
        // Parse the response for RELEASE value
        const releaseMatch = rawResponse.body.match(/<RELEASE>([^<]+)<\/RELEASE>/i);
        if (releaseMatch && releaseMatch[1]) {
          const release = releaseMatch[1].trim();
          const version = parseReleaseToVersion(release);
          return { version, isLegacy: version <= 731, release };
        }
      }
    } catch (_) {}

    // Method 4: Check system info endpoint
    try {
      const infoResponse = await h.request('/sap/bc/adt/repository/informationsystem/systeminfo', {
        method: 'GET',
        headers: { Accept: 'application/xml' }
      }).catch(() => null);

      if (infoResponse?.body) {
        // Look for SAP_BASIS or release info in the response
        const basisMatch = infoResponse.body.match(/SAP_BASIS[^>]*release[^=]*="([^"]+)"/i);
        if (basisMatch && basisMatch[1]) {
          const release = basisMatch[1].trim();
          const version = parseReleaseToVersion(release);
          return { version, isLegacy: version <= 731, release };
        }
      }
    } catch (_) {}

    // If all methods fail, check if this is a known legacy system by testing API behavior
    // Try a simple program validation - legacy systems return different response
    try {
      const testResponse = await h.request('/sap/bc/adt/programs/validation', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.programs.validation'
        },
        qs: { objname: 'ZTEST_VERSION_CHECK', packagename: '$TMP', description: 'Version Check', objtype: 'PROG/P' }
      }).catch(() => null);

      // Check Content-Type of response - legacy systems use different format
      const contentType = testResponse?.headers?.['content-type'] || '';
      if (contentType.includes('v2') || contentType.includes('v1')) {
        // Modern system with versioned content types
        return { version: 752, isLegacy: false, release: '7.52+' };
      } else if (contentType.includes('application/vnd.sap.as+xml')) {
        // Legacy system (SAP_BASIS 731 uses asx:abap format)
        return { version: 731, isLegacy: true, release: '731' };
      }
    } catch (_) {}

    // Default: assume legacy system for safety (better to use legacy API on modern system than vice versa)
    // The legacy API format works on modern systems too, but the reverse is not true
    return { version: 731, isLegacy: true, release: 'unknown-legacy' };
  } catch (error) {
    // If version detection fails completely, assume legacy for compatibility
    return { version: 731, isLegacy: true, release: 'unknown-legacy' };
  }
}

/**
 * Parse SAP release string to version number
 * E.g., "731" -> 731, "7.52" -> 752, "7.40" -> 740
 */
function parseReleaseToVersion(release: string): number {
  if (!release) return 999;

  // Remove any non-numeric characters except dots
  const cleaned = release.replace(/[^0-9.]/g, '');

  // If it's already a 3-digit number like "731"
  if (/^\d{3}$/.test(cleaned)) {
    return parseInt(cleaned, 10);
  }

  // If it's a version like "7.52" or "7.40"
  const match = cleaned.match(/^(\d+)\.(\d+)/);
  if (match) {
    return parseInt(match[1] + match[2].padEnd(2, '0'), 10);
  }

  // Fallback: try parsing as integer
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 999 : parsed;
}

/**
 * Cache for SAP_BASIS version per client
 */
const versionCache = new WeakMap<ADTClient, SapBasisInfo>();

/**
 * Get cached SAP_BASIS version or fetch it
 */
export async function getCachedBasisVersion(client: ADTClient): Promise<SapBasisInfo> {
  if (versionCache.has(client)) {
    return versionCache.get(client)!;
  }

  const info = await getSapBasisVersion(client);
  versionCache.set(client, info);
  return info;
}

/**
 * Legacy ADT API methods for SAP_BASIS 731
 */
export class LegacyAdtApi {
  private client: ADTClient;
  private h: any;

  constructor(client: ADTClient) {
    this.client = client;
    this.h = (client as any).h;
  }

  /**
   * Execute ADT request via RFC (for SAP_BASIS 731)
   * This uses the SADT_REST_RFC_ENDPOINT function module
   */
  async callAdtViaRfc(method: string, uri: string, headers: Record<string, string> = {}, body?: string): Promise<{
    statusCode: string;
    reasonPhrase: string;
    body: string;
    headers: Array<{ name: string; value: string }>;
  }> {
    // Build the request structure for SADT_REST_RFC_ENDPOINT
    const request = {
      REQUEST_LINE: {
        METHOD: method,
        URI: uri,
        VERSION: 'HTTP/1.1'
      },
      HEADER_FIELDS: Object.entries(headers).map(([name, value]) => ({ NAME: name, VALUE: value })),
      MESSAGE_BODY: body ? Buffer.from(body, 'utf-8') : Buffer.alloc(0)
    };

    // Call via table/function interface
    // Note: This requires the abap-adt-api to expose RFC calls
    // For now, we'll use the HTTP client but with legacy-compatible formats
    const response = await this.h.request(uri, {
      method,
      headers,
      body
    });

    return {
      statusCode: String(response.status || response.statusCode || 0),
      reasonPhrase: response.statusText || '',
      body: response.body || '',
      headers: Object.entries(response.headers || {}).map(([name, value]) => ({ name, value: String(value) }))
    };
  }

  /**
   * Create transport request (legacy format for SAP_BASIS 731)
   */
  async createTransport(
    devclass: string,
    description: string,
    refUri?: string
  ): Promise<string> {
    // Build XML body in legacy format (asx:abap)
    let body = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml">` +
      `<asx:values><DATA>` +
      `<OPERATION>I</OPERATION>` +
      `<DEVCLASS>${this.escapeXml(devclass)}</DEVCLASS>` +
      `<REQUEST_TEXT>${this.escapeXml(description.substring(0, 60))}</REQUEST_TEXT>`;

    if (refUri) {
      body += `<REF>${this.escapeXml(refUri)}</REF>`;
    }

    body += `</DATA></asx:values></asx:abap>`;

    const response = await this.h.request('/sap/bc/cts/transports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest',
        'Accept': 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.CorrectionRequestResult'
      },
      body
    });

    // Parse transport number from response
    const responseBody = response.body || '';
    const match = responseBody.match(/(DEVK\d+|D[0-9A-Z]+K\d+)/);
    if (match) {
      return match[1];
    }

    throw new Error(`Failed to create transport: ${responseBody}`);
  }

  /**
   * Check transport requirements (legacy format for SAP_BASIS 731)
   */
  async checkTransportRequirements(
    objectUri: string,
    devclass: string,
    operation: 'I' | 'U' = 'I'
  ): Promise<{
    pgmid: string;
    object: string;
    objectName: string;
    devclass: string;
    result: string;
    recording: string;
    requests: Array<{ trkorr: string; as4text: string; as4user: string }>;
  }> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml">` +
      `<asx:values><DATA>` +
      `<PGMID></PGMID>` +
      `<OBJECT></OBJECT>` +
      `<OBJECTNAME></OBJECTNAME>` +
      `<DEVCLASS>${this.escapeXml(devclass)}</DEVCLASS>` +
      `<SUPER_PACKAGE></SUPER_PACKAGE>` +
      `<RECORD_CHANGES></RECORD_CHANGES>` +
      `<OPERATION>${operation}</OPERATION>` +
      `<URI>${this.escapeXml(objectUri)}</URI>` +
      `</DATA></asx:values></asx:abap>`;

    const response = await this.h.request('/sap/bc/cts/transportchecks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData',
        'Accept': 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData'
      },
      body
    });

    return this.parseTransportCheckResponse(response.body || '');
  }

  /**
   * Get transport info for an object by locking it
   * On SAP_BASIS 731, the lock response includes the transport request number (CORRNR)
   */
  async getTransportInfo(objectUri: string): Promise<{
    lockHandle: string;
    transportNumber: string;
    transportUser: string;
    transportText: string;
  }> {
    const response = await this.h.request(`${objectUri}?_action=LOCK&accessMode=MODIFY`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result'
      }
    });

    const body = response.body || '';

    // Parse the lock response XML
    const lockHandleMatch = body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/);
    const corrnrMatch = body.match(/<CORRNR>([^<]*)<\/CORRNR>/);
    const corruserMatch = body.match(/<CORRUSER>([^<]*)<\/CORRUSER>/);
    const corrtextMatch = body.match(/<CORRTEXT>([^<]*)<\/CORRTEXT>/);

    return {
      lockHandle: lockHandleMatch ? lockHandleMatch[1] : '',
      transportNumber: corrnrMatch ? corrnrMatch[1] : '',
      transportUser: corruserMatch ? corruserMatch[1] : '',
      transportText: corrtextMatch ? corrtextMatch[1] : ''
    };
  }

  /**
   * Unlock an object
   */
  async unlock(objectUri: string, lockHandle: string): Promise<void> {
    await this.h.request(`${objectUri}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/xml'
      }
    });
  }

  /**
   * Set transport request description (try RFC proxy first, then ADT API)
   * @param transportNumber Transport request number
   * @param description New description
   * @param server_id SAP server identifier for RFC proxy (optional)
   */
  async setTransportDescription(transportNumber: string, description: string, server_id?: string): Promise<boolean> {
    // First try RFC proxy
    if (rfcProxy.isEnabled()) {
      const result = await rfcProxy.setTransportDescription(transportNumber, description, server_id);
      if (result.success) {
        return true;
      }
    }

    // Fallback to ADT API (may not work on SAP_BASIS 731)
    try {
      const response = await this.h.request(`/sap/bc/adt/cts/transportrequests/${transportNumber}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml'
        },
        body: `<?xml version="1.0" encoding="UTF-8"?><cts:transportRequest xmlns:cts="http://www.sap.com/adt/cts" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${this.escapeXml(description.substring(0, 60))}"/>`
      });
      const statusCode = String(response.status || response.statusCode || 0);
      return statusCode === '200' || statusCode === '204';
    } catch (_) {
      return false;
    }
  }

  /**
   * Create ABAP program (legacy format for SAP_BASIS 731)
   * Returns transport info. If transportDescription is provided, creates transport via RFC proxy first.
   * @param name Program name
   * @param description Program description
   * @param package_ Package name
   * @param transport Existing transport number (optional)
   * @param transportDescription Custom transport description (optional)
   * @param server_id SAP server identifier for RFC proxy (optional)
   */
  async createProgram(
    name: string,
    description: string,
    package_: string,
    transport?: string,
    transportDescription?: string,
    server_id?: string
  ): Promise<{
    success: boolean;
    message: string;
    transportNumber?: string;
    transportText?: string;
  }> {
    // If transportDescription is provided but no transport, try to create transport via RFC proxy first
    let createdTransport: string | undefined = transport;
    let createdTransportText: string | undefined;

    if (!transport && transportDescription && rfcProxy.isEnabled()) {
      const objectUri = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
      const transportResult = await rfcProxy.createTransport(package_, transportDescription, objectUri, server_id);
      if (transportResult.success && transportResult.transport) {
        createdTransport = transportResult.transport;
        createdTransportText = transportResult.description || transportDescription;
      }
    }

    // Build XML in legacy format (attributes on root element, no version in Content-Type)
    const body = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<program:abapProgram xmlns:adtcore="http://www.sap.com/adt/core" ` +
      `xmlns:program="http://www.sap.com/adt/programs/programs" ` +
      `adtcore:description="${this.escapeXml(description)}" ` +
      `adtcore:language="EN" ` +
      `adtcore:name="${name.toUpperCase()}" ` +
      `adtcore:type="PROG/P" ` +
      `adtcore:masterLanguage="EN">` +
      `<adtcore:packageRef adtcore:name="${package_}"/>` +
      `</program:abapProgram>`;

    let uri = '/sap/bc/adt/programs/programs';
    if (createdTransport) {
      uri += `?corrNr=${createdTransport}`;
    }

    const response = await this.h.request(uri, {
      method: 'POST',
      headers: {
        // IMPORTANT: No version number in Content-Type for SAP_BASIS 731
        'Content-Type': 'application/vnd.sap.adt.programs.programs+xml',
        'Accept': 'application/vnd.sap.adt.programs.programs+xml'
      },
      body
    });

    const statusCode = String(response.status || response.statusCode || 0);
    const success = statusCode === '200' || statusCode === '201';

    // If program was created successfully, get transport info by locking it
    let transportNumber: string | undefined = createdTransport;
    let transportText: string | undefined = createdTransportText;

    if (success && !createdTransport) {
      try {
        const objectUri = `/sap/bc/adt/programs/programs/${name.toLowerCase()}`;
        const transportInfo = await this.getTransportInfo(objectUri);
        transportNumber = transportInfo.transportNumber;
        transportText = transportInfo.transportText;
        // Unlock the object after getting transport info
        if (transportInfo.lockHandle) {
          await this.unlock(objectUri, transportInfo.lockHandle);
        }
        // If custom transport description is provided, update it via RFC proxy
        if (transportNumber && transportDescription) {
          const updated = await this.setTransportDescription(transportNumber, transportDescription, server_id);
          if (updated) {
            transportText = transportDescription.substring(0, 60);
          }
        }
      } catch (e) {
        // Ignore errors getting transport info - the program was created successfully
      }
    }

    return {
      success,
      message: response.body || `Program ${name} created`,
      transportNumber,
      transportText
    };
  }

  /**
   * Activate ABAP object (legacy format for SAP_BASIS 731)
   */
  async activateObject(objectUri: string, objectName: string): Promise<{ success: boolean; messages: string[] }> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
      `<adtcore:objectReference adtcore:uri="${this.escapeXml(objectUri)}" adtcore:name="${objectName}"/>` +
      `</adtcore:objectReferences>`;

    const response = await this.h.request('/sap/bc/adt/activation?method=activate&preauditRequested=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml'
      },
      body
    });

    const statusCode = String(response.status || response.statusCode || 0);
    return {
      success: statusCode === '200',
      messages: response.body ? [response.body] : []
    };
  }

  /**
   * Activate PROG/I include with its parent program (legacy format for SAP_BASIS 731)
   * Sends both the main program and the include in one activation request.
   */
  async activateIncludeWithParent(
    includeUri: string, includeName: string,
    parentUri: string, parentName: string
  ): Promise<{ success: boolean; messages: string[] }> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
      `<adtcore:objectReference adtcore:uri="${this.escapeXml(parentUri)}" adtcore:name="${parentName}"/>` +
      `<adtcore:objectReference adtcore:uri="${this.escapeXml(includeUri)}" adtcore:name="${includeName}"/>` +
      `</adtcore:objectReferences>`;

    const response = await this.h.request('/sap/bc/adt/activation?method=activate&preauditRequested=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml'
      },
      body
    });

    const statusCode = String(response.status || response.statusCode || 0);
    return {
      success: statusCode === '200',
      messages: response.body ? [response.body] : []
    };
  }

  /**
   * Parse transport check response XML
   */
  private parseTransportCheckResponse(xml: string): any {
    const result = {
      pgmid: '',
      object: '',
      objectName: '',
      devclass: '',
      result: '',
      recording: '',
      requests: [] as Array<{ trkorr: string; as4text: string; as4user: string }>
    };

    const extractField = (name: string): string => {
      const match = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
      return match ? match[1] : '';
    };

    result.pgmid = extractField('PGMID');
    result.object = extractField('OBJECT');
    result.objectName = extractField('OBJECTNAME');
    result.devclass = extractField('DEVCLASS');
    result.result = extractField('RESULT');
    result.recording = extractField('RECORDING');

    // Extract transport requests
    const reqPattern = /<CTS_REQUEST>.*?<TRKORR>([^<]+)<\/TRKORR>.*?<AS4TEXT>([^<]*)<\/AS4TEXT>.*?<AS4USER>([^<]+)<\/AS4USER>.*?<\/CTS_REQUEST>/gs;
    let match;
    while ((match = reqPattern.exec(xml)) !== null) {
      result.requests.push({
        trkorr: match[1],
        as4text: match[2],
        as4user: match[3]
      });
    }

    return result;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
