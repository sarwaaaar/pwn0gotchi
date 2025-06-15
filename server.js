const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { Client } = require('ssh2');

const app = express();
const port = 3001;  // Changed from 3000 to 3001
const wsPort = 3002;  // Changed from 3001 to 3002

// Create HTTPS server with self-signed certificates
const httpsOptions = {
    key: fs.readFileSync('/etc/nginx/ssl/pwn0gotchi.key'),
    cert: fs.readFileSync('/etc/nginx/ssl/pwn0gotchi.crt')
};

const httpsServer = https.createServer(httpsOptions, app);
const wss = new WebSocket.Server({ server: httpsServer });

const activeConnections = new Map();
const processedMessages = new Set();

const COMMON_VENDOR_IDS = [
    0x303A, // ESP32
    0x1A86, // CH340
    0x10C4, // CP210x
    0x0403  // FTDI
];

async function findSerialPorts() {
    try {
        const ports = await SerialPort.list();
        return ports.filter(port =>
            port.vendorId && COMMON_VENDOR_IDS.includes(parseInt(port.vendorId, 16))
        );
    } catch (err) {
        console.error('Error listing serial ports:', err);
        return [];
    }
}

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
        if (connection.ssh) connection.ssh.end();
        if (connection.serialPort?.isOpen) {
            connection.serialPort.close((err) => {
                if (err) console.error('Error closing serial port:', err);
            });
        }
        if (connection.readCheckInterval) clearInterval(connection.readCheckInterval);
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

                    if (data.connectionType === 'ssh') {
                        handleSSHConnection(data, connection, sendMessage);
                    } else if (data.connectionType === 'serial') {
                        handleSerialConnection(connection, sendMessage);
                    }
                }
                break;
            case 'connect': {
                if (connection.isConnected) {
                    sendMessage({ type: 'status', status: 'already_connected' });
                    return;
                }

                connection.connectionType = data.connectionType;

                if (connection.connectionType === 'serial') {
                    try {
                        const ports = await findSerialPorts();
                        if (ports.length === 0) {
                            throw new Error('No compatible serial devices found');
                        }

                        let connected = false;
                        const baudRates = [115200, 9600, 74880, 921600];

                        for (const port of ports) {
                            for (const baudRate of baudRates) {
                                try {
                                    connection.serialPort = new SerialPort({
                                        path: port.path,
                                        baudRate: baudRate,
                                        autoOpen: false,
                                        dataBits: 8,
                                        stopBits: 1,
                                        parity: 'none',
                                        flowControl: false
                                    });

                                    const parser = connection.serialPort.pipe(new ReadlineParser({
                                        delimiter: '\r\n',
                                        encoding: 'utf8',
                                        includeDelimiter: true
                                    }));

                                    parser.on('data', (data) => {
                                        const formattedData = data.trim();
                                        if (formattedData) {
                                            sendMessage({
                                                type: 'output',
                                                data: formattedData + '\n'
                                            });
                                        }
                                    });

                                    connection.serialPort.on('error', (err) => {
                                        console.error('Serial port error:', err);
                                        sendMessage({
                                            type: 'error',
                                            message: `Serial port error: ${err.message} `,
                                            details: err
                                        });
                                    });

                                    await new Promise((resolve, reject) => {
                                        connection.serialPort.open((err) => {
                                            if (err) reject(err);
                                            else resolve();
                                        });
                                    });

                                    const initSequence = async () => {
                                        await new Promise((resolve) => {
                                            connection.serialPort.set({ dtr: false, rts: false }, () => {
                                                setTimeout(() => {
                                                    connection.serialPort.set({ dtr: true, rts: true }, resolve);
                                                }, 100);
                                            });
                                        });

                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                        await new Promise((resolve) => {
                                            connection.serialPort.write('\r\n\r\n\r\n', resolve);
                                        });
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                        await new Promise((resolve) => {
                                            connection.serialPort.write('+++', resolve);
                                        });
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                        await new Promise((resolve) => {
                                            connection.serialPort.write('AT\r\n', resolve);
                                        });
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                        await new Promise((resolve) => {
                                            connection.serialPort.write('AT+UART_DEF=115200,8,1,0,0\r\n', resolve);
                                        });
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                    };

                                    await initSequence();

                                    connected = true;
                                    sendMessage({
                                        type: 'status',
                                        status: 'connected',
                                        message: 'Serial connection established',
                                        port: port.path,
                                        baudRate: baudRate,
                                        portInfo: {
                                            manufacturer: port.manufacturer,
                                            serialNumber: port.serialNumber,
                                            vendorId: port.vendorId,
                                            productId: port.productId
                                        }
                                    });
                                    connection.isConnected = true;

                                    break;
                                } catch (err) {
                                    console.log(`Failed to connect to ${port.path} at ${baudRate} baud: `, err.message);
                                    if (connection.serialPort) {
                                        try {
                                            await connection.serialPort.close();
                                        } catch (closeErr) {
                                            console.error('Error closing port:', closeErr);
                                        }
                                    }
                                }
                            }
                            if (connected) break;
                        }

                        if (!connected) {
                            throw new Error('Failed to connect to any serial port');
                        }
                    } catch (err) {
                        console.error('Serial connection error:', err);
                        sendMessage({
                            type: 'error',
                            message: err.message,
                            details: err
                        });
                        connection.isConnected = false;
                        connection.connectionType = null;
                    }
                } else if (connection.connectionType === 'ssh') {
                    connection.ssh = new Client();
                    connection.ssh.on('ready', () => {
                        connection.isConnected = true;
                        connection.ssh.shell({ term: 'xterm-256color' }, (err, stream) => {
                            if (err) {
                                sendMessage({ type: 'error', message: err.message });
                                return;
                            }
                            connection.shellStream = stream;
                            let buffer = '';
                            let lastLine = '';
                            let isFirstOutput = true;
                            let lastPrompt = '';

                            stream.on('data', (chunk) => {
                                const newData = chunk.toString();

                                // Skip the initial system messages
                                if (isFirstOutput) {
                                    if (newData.includes('Last login:')) {
                                        isFirstOutput = false;
                                        return;
                                    }
                                    return;
                                }

                                buffer += newData;

                                if (buffer.includes('\n')) {
                                    const lines = buffer.split('\n');
                                    buffer = lines.pop();

                                    lines.forEach(line => {
                                        // Check if line is a prompt
                                        if (line.includes('┌──') && line.includes('─[')) {
                                            if (line !== lastPrompt) {
                                                lastPrompt = line;
                                                sendMessage({
                                                    type: 'output',
                                                    data: line + '\n'
                                                });
                                            }
                                        } else if (line.trim() && line !== lastLine) {
                                            lastLine = line;
                                            sendMessage({
                                                type: 'output',
                                                data: line + '\n'
                                            });
                                        }
                                    });
                                }
                            });

                            stream.stderr.on('data', (chunk) => {
                                sendMessage({
                                    type: 'error',
                                    data: chunk.toString()
                                });
                            });

                            stream.on('close', () => {
                                connection.shellStream = null;
                                connection.isConnected = false;
                                connection.connectionType = null;
                                sendMessage({ type: 'status', status: 'disconnected' });
                            });

                            sendMessage({ type: 'status', status: 'connected' });
                        });
                    });

                    connection.ssh.on('error', (err) => {
                        sendMessage({ type: 'error', message: err.message });
                    });

                    connection.ssh.on('end', () => {
                        connection.isConnected = false;
                        connection.connectionType = null;
                        sendMessage({ type: 'status', status: 'disconnected' });
                    });

                    connection.ssh.on('close', () => {
                        connection.isConnected = false;
                        connection.connectionType = null;
                        sendMessage({ type: 'status', status: 'disconnected' });
                    });

                    connection.ssh.connect({
                        host: data.host,
                        port: data.port || 22,
                        username: data.username,
                        password: data.password,
                        tryKeyboard: true,
                        readyTimeout: 30000,
                        banner: false,
                        debug: false
                    });
                }
                break;
            }

            case 'disconnect': {
                if (connection.ssh) {
                    connection.ssh.end();
                    connection.ssh = null;
                }
                if (connection.serialPort && connection.serialPort.isOpen) {
                    connection.serialPort.close((err) => {
                        if (err) {
                            console.error('Error closing serial port:', err);
                            sendMessage({
                                type: 'error',
                                message: `Error closing serial port: ${err.message} `
                            });
                        }
                    });
                    connection.serialPort = null;
                }
                if (connection.readCheckInterval) {
                    clearInterval(connection.readCheckInterval);
                    connection.readCheckInterval = null;
                }
                connection.isConnected = false;
                connection.connectionType = null;
                connection.messageIds.clear();
                sendMessage({ type: 'status', status: 'disconnected' });
                break;
            }

            case 'command': {
                if (!connection.isConnected) {
                    sendMessage({ type: 'error', message: 'Not connected' });
                    return;
                }

                if (connection.connectionType === 'serial') {
                    if (connection.serialPort && connection.serialPort.isOpen) {
                        const command = data.command + '\r\n';
                        connection.serialPort.write(command, (err) => {
                            if (err) {
                                console.error('Error writing to serial port:', err);
                                sendMessage({
                                    type: 'error',
                                    message: err.message
                                });
                                return;
                            }
                            connection.serialPort.flush();
                        });
                    } else {
                        sendMessage({ type: 'error', message: 'Serial port not open' });
                    }
                } else if (connection.connectionType === 'ssh') {
                    if (connection.shellStream) {
                        connection.shellStream.write(data.command + '\n');
                    } else {
                        sendMessage({ type: 'error', message: 'No shell stream available' });
                    }
                } else {
                    sendMessage({ type: 'error', message: 'Invalid connection type' });
                }
                break;
            }

            case 'pty_data': {
                if (!connection.isConnected) {
                    sendMessage({ type: 'error', message: 'Not connected' });
                    return;
                }

                if (connection.connectionType === 'ssh' && connection.shellStream) {
                    connection.shellStream.write(data.data);
                } else if (connection.connectionType === 'serial') {
                    if (connection.serialPort && connection.serialPort.isOpen) {
                        connection.serialPort.write(data.data);
                    }
                } else {
                    sendMessage({ type: 'error', message: 'Invalid connection type' });
                }
                break;
            }

            default:
                sendMessage({ type: 'error', message: 'Unknown command type' });
        }
    });
});

function handleSSHConnection(data, connection, sendMessage) {
    connection.ssh = new Client();

    connection.ssh.on('ready', () => {
        connection.ssh.shell({ term: 'xterm-256color' }, (err, stream) => {
            if (err) {
                sendMessage({ type: 'error', message: err.message });
                return;
            }

            connection.shellStream = stream;
            let buffer = '';
            let lastLine = '';
            let isFirstOutput = true;
            let promptCount = 0;

            stream.on('data', (chunk) => {
                const newData = chunk.toString();
                if (isFirstOutput) {
                    if (newData.includes('Last login:')) {
                        isFirstOutput = false;
                    }
                    return;
                }

                buffer += newData;
                if (buffer.includes('\n')) {
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    lines.forEach(line => {
                        if (line.includes('┌──') && line.includes('─[')) {
                            promptCount++;
                            if (promptCount === 1) {
                                sendMessage({
                                    type: 'output',
                                    data: line + '\n'
                                });
                            }
                        } else if (line.trim() && line !== lastLine) {
                            lastLine = line;
                            sendMessage({
                                type: 'output',
                                data: line + '\n'
                            });
                        }
                    });
                }
            });

            stream.stderr.on('data', (chunk) => {
                sendMessage({
                    type: 'error',
                    data: chunk.toString()
                });
            });

            stream.on('close', () => {
                connection.shellStream = null;
                connection.isConnected = false;
                connection.connectionType = null;
                sendMessage({ type: 'status', status: 'disconnected' });
            });

            sendMessage({ type: 'status', status: 'connected' });
        });
    });

    connection.ssh.on('error', (err) => {
        sendMessage({ type: 'error', message: err.message });
    });

    connection.ssh.on('end', () => {
        connection.isConnected = false;
        connection.connectionType = null;
        sendMessage({ type: 'status', status: 'disconnected' });
    });

    connection.ssh.connect({
        host: data.host,
        port: data.port || 22,
        username: data.username,
        password: data.password,
        tryKeyboard: true,
        readyTimeout: 30000,
        banner: false,
        debug: false
    });
}

async function handleSerialConnection(connection, sendMessage) {
    try {
        const ports = await findSerialPorts();
        if (ports.length === 0) {
            throw new Error('No compatible serial devices found');
        }

        const baudRates = [115200, 9600, 74880, 921600];

        for (const port of ports) {
            for (const baudRate of baudRates) {
                try {
                    connection.serialPort = new SerialPort({
                        path: port.path,
                        baudRate: baudRate,
                        autoOpen: false,
                        dataBits: 8,
                        stopBits: 1,
                        parity: 'none',
                        flowControl: false
                    });

                    const parser = connection.serialPort.pipe(new ReadlineParser({
                        delimiter: '\r\n',
                        encoding: 'utf8',
                        includeDelimiter: true
                    }));

                    parser.on('data', (data) => {
                        const formattedData = data.trim();
                        if (formattedData) {
                            sendMessage({
                                type: 'output',
                                data: formattedData + '\n'
                            });
                        }
                    });

                    connection.serialPort.on('error', (err) => {
                        console.error('Serial port error:', err);
                        sendMessage({
                            type: 'error',
                            message: `Serial port error: ${err.message}`,
                            details: err
                        });
                    });

                    await new Promise((resolve, reject) => {
                        connection.serialPort.open((err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    connection.isConnected = true;
                    sendMessage({ type: 'status', status: 'connected' });
                    return;
                } catch (err) {
                    if (connection.serialPort) {
                        connection.serialPort.close();
                    }
                }
            }
        }
        throw new Error('Failed to connect to any serial port');
    } catch (err) {
        sendMessage({
            type: 'error',
            message: err.message
        });
    }
}

// Start servers
app.listen(port, () => {
    console.log(`HTTP Server running on port ${port}`);
});

httpsServer.listen(wsPort, () => {
    console.log(`HTTPS/WebSocket Server running on port ${wsPort}`);
});
