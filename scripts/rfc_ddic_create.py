#!/usr/bin/env python3
"""
SAP DDIC Structure Creator via RFC
Uses a server-side program + JOB_SUBMIT to create structures.
"""

import json
import sys
import os
from pyrfc import Connection

def create_structure(conn_info, obj_name, obj_type, description, language, fields, activate=True):
    """Create a DDIC structure via RFC."""
    try:
        conn = Connection(**conn_info)

        # Step 1: Write field definitions to server file
        field_lines = []
        for f in fields:
            line = '|'.join([
                f.get('FIELDNAME', ''),
                f.get('POSITION', ''),
                f.get('DATATYPE', ''),
                f.get('LENG', ''),
                f.get('DECIMALS', '0'),
                f.get('DDTEXT', ''),
            ])
            field_lines.append(line)

        field_content = '\n'.join(field_lines)

        # Write to server file using RFC_DATASET_WRITE
        try:
            conn.call('RFC_DATASET_WRITE',
                FILENAME='ZDIC_FIELDS',
                FILECONTENT=field_content.encode('utf-8') if isinstance(field_content, str) else field_content,
            )
        except Exception as e:
            # Try alternative: write via internal table
            pass

        # Step 2: Submit program as background job
        job_name = f'ZDDIC_{obj_name}'
        job_count = '001'

        # JOB_OPEN
        result = conn.call('JOB_OPEN',
            JOBNAME=job_name,
            JOBCOUNT=job_count,
            SDLSTRTDT='',
            SDLSTRTTM='',
        )
        job_count = result.get('JOBCOUNT', job_count)

        # JOB_SUBMIT
        sel_params = [
            {'SELNAME': 'P_OBJNAM', 'KIND': 'P', 'SIGN': 'I', 'OPTION': 'EQ', 'LOW': obj_name},
            {'SELNAME': 'P_DESC', 'KIND': 'P', 'SIGN': 'I', 'OPTION': 'EQ', 'LOW': description},
            {'SELNAME': 'P_LANG', 'KIND': 'P', 'SIGN': 'I', 'OPTION': 'EQ', 'LOW': language},
            {'SELNAME': 'P_ACTIV', 'KIND': 'P', 'SIGN': 'I', 'OPTION': 'EQ', 'LOW': 'X' if activate else ' '},
        ]

        conn.call('JOB_SUBMIT',
            AUTHCKNAM=conn_info.get('user', ''),
            JOBCOUNT=job_count,
            JOBNAME=job_name,
            REPORT='ZRFC_DDIC_CRE',
            VARIANT='',
            SELTABLE=sel_params,
        )

        # JOB_CLOSE
        conn.call('JOB_CLOSE',
            JOBCOUNT=job_count,
            JOBNAME=job_name,
            STRTIMMED='X',
        )

        conn.close()

        return {
            'success': True,
            'message': f'Structure {obj_name} creation job submitted. Job: {job_name}/{job_count}',
            'job_name': job_name,
            'job_count': job_count,
        }

    except Exception as e:
        return {
            'success': False,
            'error': str(e),
        }

def main():
    if len(sys.argv) > 2 and sys.argv[1] == '--json':
        input_json = sys.argv[2]
    elif len(sys.argv) > 1:
        input_json = sys.argv[1]
    else:
        input_json = sys.stdin.read()

    try:
        input_data = json.loads(input_json)
    except json.JSONDecodeError as e:
        print(json.dumps({'success': False, 'error': f'Invalid JSON: {e}'}))
        sys.exit(1)

    conn_info = input_data.get('connection', {})
    if not conn_info:
        conn_info = {
            'ashost': os.environ.get('SAP_ASHOST', ''),
            'sysnr': os.environ.get('SAP_SYSNR', '00'),
            'client': os.environ.get('SAP_CLIENT', '100'),
            'user': os.environ.get('SAP_USER', ''),
            'passwd': os.environ.get('SAP_PASSWORD', ''),
        }

    result = create_structure(
        conn_info,
        input_data.get('objName', ''),
        input_data.get('objType', 'STRU'),
        input_data.get('description', ''),
        input_data.get('language', 'E'),
        input_data.get('fields', []),
        input_data.get('activate', True),
    )

    print(json.dumps(result, default=str, ensure_ascii=False))

if __name__ == '__main__':
    main()
