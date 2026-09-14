# RFC Proxy Service for SAP_BASIS 731

This service provides HTTP endpoints that proxy to SAP RFC calls. It enables the dassian-adt MCP server to perform transport-related operations on SAP_BASIS 731 (ECC 6.0) systems where direct HTTP ADT API is not available for transport endpoints.

## Prerequisites

1. **Python 3.8+**
2. **pyrfc library** - SAP Python RFC SDK
   ```bash
   pip install pyrfc
   ```

3. **SAP NW RFC SDK** - Must be installed and configured
   - Download from SAP Marketplace
   - Follow installation instructions at: https://github.com/SAP/node-rfc

## Configuration

Edit `config.json`:

```json
{
  "rfc": {
    "ashost": "dev-sap.example.com",
    "sysnr": "00",
    "client": "100",
    "user": "YOUR_USER",
    "passwd": "your_password",
    "lang": "EN"
  },
  "server": {
    "host": "127.0.0.1",
    "port": 5100
  }
}
```

## Usage

### Start the RFC Proxy Service

```bash
# Using Python directly
python rfc_proxy.py --config config.json

# Or use the batch file (Windows)
start.bat
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/config` | Get configuration (without sensitive data) |
| POST | `/transport/create` | Create a new transport request |
| POST | `/transport/set-desc` | Update transport request description |
| POST | `/transport/check` | Check transport requirements for an object |
| POST | `/adt/call` | Generic ADT call via SADT_REST_RFC_ENDPOINT |

### Example Requests

#### Create Transport Request
```bash
curl -X POST http://127.0.0.1:5100/transport/create \
  -H "Content-Type: application/json" \
  -d '{
    "devclass": "ZDEV",
    "description": "My transport description",
    "ref_uri": "/sap/bc/adt/programs/programs/zfir070"
  }'
```

Response:
```json
{
  "success": true,
  "transport": "DEVK935175",
  "description": "My transport description",
  "message": "Transport DEVK935175 created successfully"
}
```

#### Update Transport Description
```bash
curl -X POST http://127.0.0.1:5100/transport/set-desc \
  -H "Content-Type: application/json" \
  -d '{
    "transport": "DEVK935175",
    "description": "New description"
  }'
```

#### Check Transport Requirements
```bash
curl -X POST http://127.0.0.1:5100/transport/check \
  -H "Content-Type: application/json" \
  -d '{
    "object_uri": "/sap/bc/adt/programs/programs/zfir070",
    "devclass": "ZDEV",
    "operation": "I"
  }'
```

#### Generic ADT Call
```bash
curl -X POST http://127.0.0.1:5100/adt/call \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "uri": "/sap/bc/cts/transports",
    "headers": {
      "Content-Type": "application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest"
    },
    "body": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><asx:abap version=\"1.0\" xmlns:asx=\"http://www.sap.com/abapxml\"><asx:values><DATA><OPERATION>I</OPERATION><DEVCLASS>ZDEV</DEVCLASS><REQUEST_TEXT>Test</REQUEST_TEXT></DATA></asx:values></asx:abap>"
  }'
```

## Integration with MCP Server

The MCP server automatically uses the RFC proxy for transport operations on SAP_BASIS 731 systems when:

1. `RFC_PROXY_ENABLED=true` in `.env`
2. `RFC_PROXY_URL` points to the running proxy service

Environment variables in `.env`:
```
RFC_PROXY_URL=http://127.0.0.1:5100
RFC_PROXY_ENABLED=true
```

## How It Works

On SAP_BASIS 731, the `/sap/bc/cts/transports` endpoint is not directly accessible via HTTP. Eclipse ADT works because it uses JCo (SAP Java Connector) which routes requests through RFC.

The RFC proxy uses the `SADT_REST_RFC_ENDPOINT` function module to make ADT REST API calls via RFC, which is the same approach Eclipse uses.

## Troubleshooting

### pyrfc not available
If pyrfc is not installed, the service will run in simulation mode and return mock responses.

### Connection failed
- Check SAP system is reachable
- Verify user credentials in config.json
- Ensure SAP NW RFC SDK is properly installed

### Port already in use
Change the port in config.json or use `--port` argument:
```bash
python rfc_proxy.py --port 5200
```
