#!/usr/bin/env python3
"""
SAP RFC Call Script for MCP
Call any RFC-enabled function module with parameters.
Usage: python rfc_call.py --json '<json_input>'
Input JSON format:
{
    "connection": {
        "ashost": "your-sap-host.example.com",
        "sysnr": "00",
        "client": "100",
        "user": "YOUR_USER",
        "passwd": "YOUR_PASSWORD"
    },
    "function": "ZMCP_DDIC_CREATE",
    "params": {
        "IV_OBJNAME": "ZS_TEST",
        "IV_OBJTYPE": "STRU",
        ...
    },
    "tables": {
        "IT_FIELDS": [
            {"FIELDNAME": "MJAHR", "POSITION": "0001", ...}
        ]
    }
}
Output: JSON with success/error status and results.
"""

import json
import sys
import os
from pyrfc import Connection

def convert_value(val, field_meta=None):
    """Convert a value to the appropriate type for RFC."""
    if val is None:
        return ''
    if isinstance(val, (int, float)):
        return val
    return str(val)

def call_rfc(conn_info, function_name, params=None, tables=None):
    """Call an RFC function module and return results."""
    try:
        # Connect to SAP
        conn = Connection(**conn_info)

        # Prepare parameters
        rfc_params = {}

        # Add import parameters
        if params:
            for key, value in params.items():
                rfc_params[key] = convert_value(value)

        # Add table parameters
        if tables:
            for key, rows in tables.items():
                if isinstance(rows, list):
                    # Convert each row to ensure proper types
                    converted_rows = []
                    for row in rows:
                        converted_row = {}
                        for field_name, field_value in row.items():
                            converted_row[field_name] = convert_value(field_value)
                        converted_rows.append(converted_row)
                    rfc_params[key] = converted_rows
                else:
                    rfc_params[key] = rows

        # Auto-fix common DDIC field issues
        # If IT_FIELDS is present and DDLANGUAGE is missing, add it
        if 'IT_FIELDS' in rfc_params and isinstance(rfc_params['IT_FIELDS'], list):
            lang = rfc_params.get('IV_LANGUAGE', rfc_params.get('IV_DDLANGUAGE', 'E'))
            for row in rfc_params['IT_FIELDS']:
                if isinstance(row, dict) and 'DDLANGUAGE' not in row:
                    row['DDLANGUAGE'] = lang
                # Ensure LENG and DECIMALS are NUMC format (6 digits for LENG, 3 for DECIMALS)
                if 'LENG' in row and isinstance(row['LENG'], str):
                    row['LENG'] = row['LENG'].zfill(6)
                if 'DECIMALS' in row and isinstance(row['DECIMALS'], str):
                    row['DECIMALS'] = row['DECIMALS'].zfill(3)
                if 'POSITION' in row and isinstance(row['POSITION'], str):
                    row['POSITION'] = row['POSITION'].zfill(4)

        # Call the function module
        result = conn.call(function_name.upper(), **rfc_params)

        conn.close()

        return {
            "success": True,
            "function": function_name,
            "result": result
        }

    except Exception as e:
        return {
            "success": False,
            "function": function_name,
            "error": str(e)
        }

def main():
    """Main entry point."""
    # Read input from command line or stdin
    if len(sys.argv) > 2 and sys.argv[1] == '--json':
        input_json = sys.argv[2]
    elif len(sys.argv) > 1:
        input_json = sys.argv[1]
    else:
        input_json = sys.stdin.read()

    try:
        input_data = json.loads(input_json)
    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "error": f"Invalid JSON input: {str(e)}"
        }))
        sys.exit(1)

    # Extract connection parameters
    conn_info = input_data.get('connection', {})
    if not conn_info:
        # Try to get from environment variables
        conn_info = {
            'ashost': os.environ.get('SAP_ASHOST', os.environ.get('SAP_HOST', '')),
            'sysnr': os.environ.get('SAP_SYSNR', '00'),
            'client': os.environ.get('SAP_CLIENT', '100'),
            'user': os.environ.get('SAP_USER', ''),
            'passwd': os.environ.get('SAP_PASSWORD', ''),
        }

    # Validate required connection parameters
    required = ['ashost', 'user', 'passwd']
    missing = [f for f in required if not conn_info.get(f)]
    if missing:
        print(json.dumps({
            "success": False,
            "error": f"Missing connection parameters: {', '.join(missing)}"
        }))
        sys.exit(1)

    # Extract function call parameters
    function_name = input_data.get('function', '')
    if not function_name:
        print(json.dumps({
            "success": False,
            "error": "Missing 'function' parameter"
        }))
        sys.exit(1)

    params = input_data.get('params', {})
    tables = input_data.get('tables', {})

    # Call the RFC function
    result = call_rfc(conn_info, function_name, params, tables)

    # Output result as JSON
    print(json.dumps(result, default=str, ensure_ascii=False))

if __name__ == '__main__':
    main()
