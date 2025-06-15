const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const port = args.find(arg => arg.startsWith('--port='))?.split('=')[1] || 3001;
const wsPort = args.find(arg => arg.startsWith('--ws-port='))?.split('=')[1] || 3002;

const app = express();

// Enable CORS
app.use(cors());

// SSL certificate paths
const sslKeyPath = '/etc/nginx/ssl/pwn0gotchi.key';
const sslCertPath = '/etc/nginx/ssl/pwn0gotchi.crt';

// Verify SSL certificates exist
if (!fs.existsSync(sslKeyPath) || !fs.existsSync(sslCertPath)) {
    console.error('SSL certificates not found at:', { sslKeyPath, sslCertPath });
    process.exit(1);
}

// Create HTTPS server with self-signed certificates
const httpsOptions = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath)
};

const httpsServer = https.createServer(httpsOptions, app);
const wss = new WebSocket.Server({
    server: httpsServer,
    path: '/ws',
    perMessageDeflate: false
});

const activeConnections = new Map();
const processedMessages = new Set();

function generateMessageId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    const connectionId = generateMessageId();
    const connection = {
        ws,
        isConnected: false,
        connectionType: null,
        messageIdCounter: 0
    };
    activeConnections.set(connectionId, connection);

    const sendMessage = (data) => {
        const messageId = connection.messageIdCounter++;
        ws.send(JSON.stringify({ ...data, id: messageId }));
    };

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        sendMessage({
            type: 'error',
            message: 'Connection error',
            debug: err.message
        });
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
        activeConnections.delete(connectionId);
    });

    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        console.log('Received message:', data);

        if (data.id && processedMessages.has(data.id)) return;
        if (data.id) {
            processedMessages.add(data.id);
            if (processedMessages.size > 1000) {
                const firstId = processedMessages.values().next().value;
                processedMessages.delete(firstId);
            }
        }

        switch (data.type) {
            case 'status':
                if (data.status === 'connected') {
                    connection.isConnected = true;
                    connection.connectionType = data.connectionType;
                    sendMessage({
                        type: 'status',
                        status: 'connected',
                        message: 'Connection established'
                    });
                }
                break;
            default:
                sendMessage({
                    type: 'error',
                    message: 'Unknown message type'
                });
        }
    });
});

// Start the servers
httpsServer.listen(wsPort, () => {
    console.log(`HTTPS/WebSocket Server running on port ${wsPort}`);
});

app.listen(port, () => {
    console.log(`HTTP Server running on port ${port}`);
});
