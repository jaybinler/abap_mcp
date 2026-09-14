#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAP RFC Proxy Service for dassian-adt MCP Server

This service provides HTTP endpoints that proxy to SAP RFC calls.
It enables MCP server to perform transport-related operations on SAP_BASIS 731
systems where direct HTTP ADT API is not available for transport endpoints.

Supports multiple SAP servers - specify server ID in request or use default.

Usage:
    python rfc_proxy.py [--config config.json] [--port 5101]

Endpoints:
    POST /transport/create       - Create a new transport request
    POST /transport/set-desc     - Update transport request description
    POST /transport/check        - Check transport requirements
    POST /adt/call               - Generic ADT call via SADT_REST_RFC_ENDPOINT
    GET /health                  - Health check
    GET /servers                 - List available servers
"""

import argparse
import json
import logging
import os
import sys
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global config
CONFIG = {
    'default_server': 'DEV',
    'servers': {
        'DEV': {
            'description': 'Default development system',
            'rfc': {
                'ashost': '127.0.0.1',
                'sysnr': '00',
                'client': '100',
                'user': '',
                'passwd': '',
                'lang': 'EN'
            }
        }
    },
    'server': {
        'host': '127.0.0.1',
        'port': 5101
    }
}

# Connection pool for RFC connections
_connection_pool = {}

# Try to import pyrfc
try:
    from pyrfc import Connection
    PYRFC_AVAILABLE = True
    logger.info("pyrfc module loaded successfully")
except ImportError:
    PYRFC_AVAILABLE = False
    logger.warning("pyrfc module not available - RFC calls will be simulated")


def get_rfc_connection(server_id=None):
    """Get RFC connection for specified server (from pool or create new)"""
    if not PYRFC_AVAILABLE:
        raise Exception('pyrfc module not available')

    if server_id is None:
        server_id = CONFIG.get('default_server', 'DEV')

    servers = CONFIG.get('servers', {})
    if server_id not in servers:
        raise Exception(f'Server "{server_id}" not found in configuration')

    server_config = servers[server_id]
    rfc_config = server_config.get('rfc', {})

    # Create new connection (pyrfc handles connection pooling internally)
    return Connection(**rfc_config)


class RFCProxyHandler(BaseHTTPRequestHandler):
    """HTTP request handler for RFC proxy"""

    def log_message(self, format, *args):
        """Override to use our logger"""
        logger.info("%s - %s", self.address_string(), format % args)

    def send_json_response(self, status_code, data):
        """Send JSON response"""
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        response = json.dumps(data, ensure_ascii=False, indent=2)
        self.wfile.write(response.encode('utf-8'))

    def send_error_response(self, status_code, message, details=None):
        """Send error response"""
        error_data = {
            'success': False,
            'error': message
        }
        if details:
            error_data['details'] = details
        self.send_json_response(status_code, error_data)

    def get_server_id(self, data):
        """Extract server_id from request data or use default"""
        server_id = data.get('server_id') or data.get('sap_system_id')
        if server_id is None:
            server_id = CONFIG.get('default_server', 'DEV')
        return server_id

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """Handle GET requests"""
        parsed_path = urlparse(self.path)

        if parsed_path.path == '/health':
            self.handle_health()
        elif parsed_path.path == '/config':
            self.handle_get_config()
        elif parsed_path.path == '/servers':
            self.handle_list_servers()
        else:
            self.send_error_response(404, f'Endpoint not found: {parsed_path.path}')

    def do_POST(self):
        """Handle POST requests"""
        parsed_path = urlparse(self.path)

        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b''

        # Try to decode with UTF-8 first, then fall back to other encodings
        body = ''
        if raw_body:
            for encoding in ['utf-8', 'gbk', 'gb2312', 'latin-1']:
                try:
                    body = raw_body.decode(encoding)
                    break
                except (UnicodeDecodeError, LookupError):
                    continue
            if not body:
                body = raw_body.decode('utf-8', errors='replace')

        # Parse JSON body if present
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError as e:
            self.send_error_response(400, 'Invalid JSON body', str(e))
            return

        # Route to appropriate handler
        if parsed_path.path == '/transport/create':
            self.handle_transport_create(data)
        elif parsed_path.path == '/transport/set-desc':
            self.handle_transport_set_desc(data)
        elif parsed_path.path == '/transport/check':
            self.handle_transport_check(data)
        elif parsed_path.path == '/adt/call':
            self.handle_adt_call(data)
        else:
            self.send_error_response(404, f'Endpoint not found: {parsed_path.path}')

    def handle_health(self):
        """Health check endpoint"""
        self.send_json_response(200, {
            'status': 'ok',
            'pyrfc_available': PYRFC_AVAILABLE,
            'default_server': CONFIG.get('default_server', 'DEV'),
            'available_servers': list(CONFIG.get('servers', {}).keys()),
            'server': CONFIG.get('server', {})
        })

    def handle_get_config(self):
        """Get current config (without sensitive data)"""
        servers_safe = {}
        for sid, sconfig in CONFIG.get('servers', {}).items():
            rfc = sconfig.get('rfc', {})
            servers_safe[sid] = {
                'description': sconfig.get('description', ''),
                'rfc': {
                    'ashost': rfc.get('ashost', ''),
                    'sysnr': rfc.get('sysnr', ''),
                    'client': rfc.get('client', ''),
                    'lang': rfc.get('lang', 'EN'),
                    'user': rfc.get('user', '')
                    # passwd is intentionally excluded
                }
            }

        safe_config = {
            'default_server': CONFIG.get('default_server', 'DEV'),
            'servers': servers_safe,
            'server': CONFIG.get('server', {})
        }
        self.send_json_response(200, safe_config)

    def handle_list_servers(self):
        """List available SAP servers"""
        servers = []
        for sid, sconfig in CONFIG.get('servers', {}).items():
            servers.append({
                'id': sid,
                'description': sconfig.get('description', ''),
                'is_default': sid == CONFIG.get('default_server')
            })
        self.send_json_response(200, {
            'default_server': CONFIG.get('default_server', 'DEV'),
            'servers': servers
        })

    def handle_transport_create(self, data):
        """
        Create a new transport request

        Expected data:
        {
            "server_id": "DEV",  (optional, defaults to default_server)
            "devclass": "ZDEV",
            "description": "Transport description",
            "ref_uri": "/sap/bc/adt/programs/programs/zfir070" (optional)
        }
        """
        server_id = self.get_server_id(data)
        devclass = data.get('devclass', '$TMP')
        description = data.get('description', '')[:60]  # Max 60 chars
        ref_uri = data.get('ref_uri', '')

        logger.info(f"Creating transport: server={server_id}, devclass={devclass}, description={description}")

        if not PYRFC_AVAILABLE:
            # Simulate response for testing
            self.send_json_response(200, {
                'success': True,
                'transport': 'SIMULATED',
                'server_id': server_id,
                'message': 'Simulated transport (pyrfc not available)'
            })
            return

        try:
            conn = get_rfc_connection(server_id)
            method = 'POST'
            uri = '/sap/bc/cts/transports'

            # Build request body
            body_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml">
<asx:values><DATA>
<OPERATION>I</OPERATION>
<DEVCLASS>{self._escape_xml(devclass)}</DEVCLASS>
<REQUEST_TEXT>{self._escape_xml(description)}</REQUEST_TEXT>'''

            if ref_uri:
                body_xml += f'<REF>{self._escape_xml(ref_uri)}</REF>'

            body_xml += '''</DATA></asx:values></asx:abap>'''

            headers = [
                {'NAME': 'Content-Type', 'VALUE': 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest'},
                {'NAME': 'Accept', 'VALUE': 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.CorrectionRequestResult, text/plain'}
            ]

            request = {
                'REQUEST_LINE': {
                    'METHOD': method,
                    'URI': uri,
                    'VERSION': 'HTTP/1.1'
                },
                'HEADER_FIELDS': headers,
                'MESSAGE_BODY': body_xml.encode('utf-8')
            }

            result = conn.call('SADT_REST_RFC_ENDPOINT', REQUEST=request)
            response = result.get('RESPONSE', {})

            status_line = response.get('STATUS_LINE', {})
            status_code = str(status_line.get('STATUS_CODE', 0)).strip()
            response_body = response.get('MESSAGE_BODY', b'')

            if isinstance(response_body, bytes):
                response_body_str = response_body.decode('utf-8', errors='replace')
            else:
                response_body_str = str(response_body)

            # Parse transport number from response
            # Response format: /com.sap.cts/object_record/DEVK935175
            import re
            match = re.search(r'(DEVK\d+|D[0-9A-Z]+K\d+)', response_body_str)
            transport_number = match.group(1) if match else None

            logger.info(f"RFC response: status_code=[{status_code}], transport_number={transport_number}")

            if status_code == '200' and transport_number:
                result_data = {
                    'success': True,
                    'transport': transport_number,
                    'description': description,
                    'server_id': server_id,
                    'message': f'Transport {transport_number} created successfully on {server_id}'
                }
            else:
                result_data = {
                    'success': False,
                    'error': 'Failed to create transport',
                    'status_code': status_code,
                    'response': response_body_str[:500]
                }

            # Close connection
            try:
                conn.close()
            except:
                pass

            self.send_json_response(200, result_data)

        except Exception as e:
            logger.error(f"Error creating transport: {e}")
            traceback.print_exc()
            self.send_error_response(500, 'RFC call failed', str(e))

    def handle_transport_set_desc(self, data):
        """
        Update transport request description

        Expected data:
        {
            "server_id": "DEV",  (optional)
            "transport": "DEVK935175",
            "description": "New description"
        }
        """
        server_id = self.get_server_id(data)
        transport = data.get('transport', '').upper()
        description = data.get('description', '')[:60]

        if not transport:
            self.send_error_response(400, 'Transport number is required')
            return

        logger.info(f"Updating transport description: server={server_id}, {transport} -> {description}")

        if not PYRFC_AVAILABLE:
            self.send_json_response(200, {
                'success': True,
                'transport': transport,
                'description': description,
                'server_id': server_id,
                'message': 'Simulated update (pyrfc not available)'
            })
            return

        try:
            conn = get_rfc_connection(server_id)

            # Method 1: Try TRINT_CHANGE_TR_DESCRIPTION
            try:
                result = conn.call(
                    'TRINT_CHANGE_TR_DESCRIPTION',
                    IV_TRKORR=transport,
                    IV_NEW_TEXT=description
                )
                try:
                    conn.close()
                except:
                    pass
                self.send_json_response(200, {
                    'success': True,
                    'transport': transport,
                    'description': description,
                    'server_id': server_id,
                    'message': f'Transport {transport} description updated',
                    'method': 'TRINT_CHANGE_TR_DESCRIPTION'
                })
                return
            except Exception as e1:
                logger.warning(f"TRINT_CHANGE_TR_DESCRIPTION failed: {e1}")

            # Method 2: Try via ADT REST API
            method = 'PUT'
            uri = f'/sap/bc/adt/cts/transportrequests/{transport}'

            body_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<cts:transportRequest xmlns:cts="http://www.sap.com/adt/cts"
                      xmlns:adtcore="http://www.sap.com/adt/core"
                      adtcore:description="{self._escape_xml(description)}"/>'''

            headers = [
                {'NAME': 'Content-Type', 'VALUE': 'application/xml'},
                {'NAME': 'Accept', 'VALUE': 'application/xml'}
            ]

            request = {
                'REQUEST_LINE': {
                    'METHOD': method,
                    'URI': uri,
                    'VERSION': 'HTTP/1.1'
                },
                'HEADER_FIELDS': headers,
                'MESSAGE_BODY': body_xml.encode('utf-8')
            }

            result = conn.call('SADT_REST_RFC_ENDPOINT', REQUEST=request)
            response = result.get('RESPONSE', {})
            status_line = response.get('STATUS_LINE', {})
            status_code = str(status_line.get('STATUS_CODE', 0)).strip()

            try:
                conn.close()
            except:
                pass

            if status_code in ['200', '204']:
                self.send_json_response(200, {
                    'success': True,
                    'transport': transport,
                    'description': description,
                    'server_id': server_id,
                    'message': f'Transport {transport} description updated',
                    'method': 'ADT_REST_API'
                })
            else:
                self.send_json_response(500, {
                    'success': False,
                    'error': 'Failed to update transport description',
                    'status_code': status_code
                })

        except Exception as e:
            logger.error(f"Error updating transport description: {e}")
            self.send_error_response(500, 'RFC call failed', str(e))

    def handle_transport_check(self, data):
        """
        Check transport requirements for an object

        Expected data:
        {
            "server_id": "DEV",  (optional)
            "object_uri": "/sap/bc/adt/programs/programs/zfir070",
            "devclass": "ZDEV",
            "operation": "I" (I=Insert, U=Update)
        }
        """
        server_id = self.get_server_id(data)
        object_uri = data.get('object_uri', '')
        devclass = data.get('devclass', '$TMP')
        operation = data.get('operation', 'I')

        logger.info(f"Checking transport: server={server_id}, uri={object_uri}, devclass={devclass}")

        if not PYRFC_AVAILABLE:
            self.send_json_response(200, {
                'success': True,
                'server_id': server_id,
                'needs_transport': True,
                'available_requests': [],
                'message': 'Simulated response (pyrfc not available)'
            })
            return

        try:
            conn = get_rfc_connection(server_id)
            method = 'POST'
            uri = '/sap/bc/cts/transportchecks'

            body_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml">
<asx:values><DATA>
<PGMID></PGMID>
<OBJECT></OBJECT>
<OBJECTNAME></OBJECTNAME>
<DEVCLASS>{self._escape_xml(devclass)}</DEVCLASS>
<SUPER_PACKAGE></SUPER_PACKAGE>
<RECORD_CHANGES></RECORD_CHANGES>
<OPERATION>{operation}</OPERATION>
<URI>{self._escape_xml(object_uri)}</URI>
</DATA></asx:values></asx:abap>'''

            headers = [
                {'NAME': 'Content-Type', 'VALUE': 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.transport.service.checkData'},
                {'NAME': 'Accept', 'VALUE': 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.transport.service.checkData'}
            ]

            request = {
                'REQUEST_LINE': {
                    'METHOD': method,
                    'URI': uri,
                    'VERSION': 'HTTP/1.1'
                },
                'HEADER_FIELDS': headers,
                'MESSAGE_BODY': body_xml.encode('utf-8')
            }

            result = conn.call('SADT_REST_RFC_ENDPOINT', REQUEST=request)
            response = result.get('RESPONSE', {})

            status_line = response.get('STATUS_LINE', {})
            status_code = str(status_line.get('STATUS_CODE', 0)).strip()
            response_body = response.get('MESSAGE_BODY', b'')

            if isinstance(response_body, bytes):
                response_body_str = response_body.decode('utf-8', errors='replace')
            else:
                response_body_str = str(response_body)

            try:
                conn.close()
            except:
                pass

            if status_code == '200':
                # Parse the response
                parsed = self._parse_transport_check_response(response_body_str)
                self.send_json_response(200, {
                    'success': True,
                    'server_id': server_id,
                    **parsed
                })
            else:
                self.send_json_response(500, {
                    'success': False,
                    'error': 'Transport check failed',
                    'status_code': status_code,
                    'response': response_body_str[:500]
                })

        except Exception as e:
            logger.error(f"Error checking transport: {e}")
            self.send_error_response(500, 'RFC call failed', str(e))

    def handle_adt_call(self, data):
        """
        Generic ADT call via SADT_REST_RFC_ENDPOINT

        Expected data:
        {
            "server_id": "DEV",  (optional)
            "method": "POST",
            "uri": "/sap/bc/cts/transports",
            "headers": {"Content-Type": "application/xml", ...},
            "body": "<xml>...</xml>"
        }
        """
        server_id = self.get_server_id(data)
        method = data.get('method', 'GET').upper()
        uri = data.get('uri', '/')
        headers_dict = data.get('headers', {})
        body = data.get('body', '')

        logger.info(f"ADT call: server={server_id}, {method} {uri}")

        if not PYRFC_AVAILABLE:
            self.send_json_response(200, {
                'success': True,
                'server_id': server_id,
                'status_code': 200,
                'body': '',
                'message': 'Simulated response (pyrfc not available)'
            })
            return

        try:
            conn = get_rfc_connection(server_id)

            # Handle headers as either dict or list
            headers_dict = data.get('headers', {})
            if isinstance(headers_dict, list):
                # Already a list of {NAME, VALUE} objects
                headers = headers_dict
            elif isinstance(headers_dict, dict):
                # Convert dict to list format
                headers = [{'NAME': k, 'VALUE': v} for k, v in headers_dict.items()]
            else:
                headers = []

            request = {
                'REQUEST_LINE': {
                    'METHOD': method,
                    'URI': uri,
                    'VERSION': 'HTTP/1.1'
                },
                'HEADER_FIELDS': headers,
                'MESSAGE_BODY': body.encode('utf-8') if body else b''
            }

            result = conn.call('SADT_REST_RFC_ENDPOINT', REQUEST=request)
            response = result.get('RESPONSE', {})

            status_line = response.get('STATUS_LINE', {})
            status_code = str(status_line.get('STATUS_CODE', 0)).strip()
            reason_phrase = status_line.get('REASON_PHRASE', '')
            response_body = response.get('MESSAGE_BODY', b'')
            response_headers = response.get('HEADER_FIELDS', [])

            if isinstance(response_body, bytes):
                response_body_str = response_body.decode('utf-8', errors='replace')
            else:
                response_body_str = str(response_body)

            try:
                conn.close()
            except:
                pass

            self.send_json_response(200, {
                'success': int(status_code) < 400 if status_code.isdigit() else False,
                'server_id': server_id,
                'status_code': int(status_code) if status_code.isdigit() else status_code,
                'reason_phrase': reason_phrase,
                'headers': {h['NAME']: h['VALUE'] for h in response_headers},
                'body': response_body_str
            })

        except Exception as e:
            logger.error(f"Error in ADT call: {e}")
            self.send_error_response(500, 'RFC call failed', str(e))

    def _escape_xml(self, s):
        """Escape XML special characters"""
        if not s:
            return ''
        return (str(s)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&apos;'))

    def _parse_transport_check_response(self, xml):
        """Parse transport check response XML"""
        import re

        def extract_field(name):
            match = re.search(f'<{name}>([^<]*)</{name}>', xml)
            return match.group(1) if match else ''

        result = {
            'pgmid': extract_field('PGMID'),
            'object': extract_field('OBJECT'),
            'object_name': extract_field('OBJECTNAME'),
            'devclass': extract_field('DEVCLASS'),
            'result': extract_field('RESULT'),
            'recording': extract_field('RECORDING'),
            'needs_transport': extract_field('RECORDING') == 'X',
            'available_requests': []
        }

        # Extract transport requests
        req_pattern = r'<CTS_REQUEST>.*?<TRKORR>([^<]+)</TRKORR>.*?<AS4TEXT>([^<]*)</AS4TEXT>.*?<AS4USER>([^<]+)</AS4USER>.*?</CTS_REQUEST>'
        for match in re.finditer(req_pattern, xml, re.DOTALL):
            result['available_requests'].append({
                'trkorr': match.group(1),
                'as4text': match.group(2),
                'as4user': match.group(3)
            })

        return result


def load_config(config_path):
    """Load configuration from JSON file"""
    global CONFIG

    if config_path and os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            loaded = json.load(f)
            # Merge with defaults
            if 'default_server' in loaded:
                CONFIG['default_server'] = loaded['default_server']
            if 'servers' in loaded:
                CONFIG['servers'] = loaded['servers']
            if 'server' in loaded:
                CONFIG['server'].update(loaded['server'])
        logger.info(f"Configuration loaded from {config_path}")
        logger.info(f"Available servers: {list(CONFIG['servers'].keys())}")
        logger.info(f"Default server: {CONFIG['default_server']}")
    else:
        logger.warning(f"Configuration file not found: {config_path}, using defaults")


def run_server(host, port):
    """Run the HTTP server"""
    server_address = (host, port)
    httpd = HTTPServer(server_address, RFCProxyHandler)

    logger.info(f"RFC Proxy Server starting on http://{host}:{port}")
    logger.info(f"Endpoints:")
    logger.info(f"  GET  /health              - Health check")
    logger.info(f"  GET  /servers             - List available SAP servers")
    logger.info(f"  GET  /config              - Get configuration")
    logger.info(f"  POST /transport/create    - Create transport request")
    logger.info(f"  POST /transport/set-desc  - Update transport description")
    logger.info(f"  POST /transport/check     - Check transport requirements")
    logger.info(f"  POST /adt/call            - Generic ADT call")
    logger.info(f"")
    logger.info(f"Available SAP servers: {list(CONFIG.get('servers', {}).keys())}")
    logger.info(f"Default server: {CONFIG.get('default_server', 'DEV')}")
    logger.info(f"pyrfc available: {PYRFC_AVAILABLE}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
        httpd.shutdown()


def main():
    parser = argparse.ArgumentParser(description='SAP RFC Proxy Service')
    parser.add_argument('--config', '-c',
                        default='config.json',
                        help='Path to configuration file (default: config.json)')
    parser.add_argument('--port', '-p',
                        type=int,
                        help='Server port (overrides config file)')
    parser.add_argument('--host',
                        help='Server host (overrides config file)')

    args = parser.parse_args()

    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, args.config)

    # Load configuration
    load_config(config_path)

    # Override with command line arguments
    host = args.host or CONFIG['server']['host']
    port = args.port or CONFIG['server']['port']

    run_server(host, port)


if __name__ == '__main__':
    main()
