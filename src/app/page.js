'use client';

import { useState, useEffect, useRef } from 'react';

// ANSI color helpers
const ANSI = {
  reset: '\u001b[0m',
  system: '\u001b[38;2;62;128;131m', // #3E8083
  error: '\u001b[38;2;165;66;65m',  // #A54241
  success: '\u001b[38;2;181;189;104m', // #B5BD68
  info: '\u001b[38;2;222;147;95m', // #DE935F
  art: '\u001b[38;2;216;25;96m', // #D81960
};

// Command aliases
const commandAliases = {
  'cls': 'clear',
  'h': 'history',
  '?': 'help'
};

// Helper to write colored messages to terminal
function writeMessage(term, type, text) {
  const color = ANSI[type] || '';
  term.writeln(`${color}${text}${ANSI.reset} `);
}

// Command registry for dynamic autocomplete and handling
const commandRegistry = [
  {
    name: 'connect -ssh',
    handler: (args, context) => {
      let { ws, xtermRef, setConnectionType } = context;
      let host, username, password;
      const connectionString = args[2];
      if (!connectionString) {
        xtermRef.current.writeln(`${ANSI.error} [-] Usage: connect - ssh < username@host> -p < password > ${ANSI.reset} `);
        return;
      }
      if (connectionString.includes('@')) {
        [username, host] = connectionString.split('@');
      } else {
        host = connectionString;
        username = args[3] || '';
      }
      const passwordIndex = args.findIndex(arg => arg === '-p');
      if (passwordIndex !== -1 && args[passwordIndex + 1]) {
        password = args[passwordIndex + 1].replace(/^\["']|["']$/g, '');
      } else {
        password = args[4] || '';
      }
      if (!host || !username || !password) {
        xtermRef.current.writeln(`${ANSI.error} [-] Usage: connect - ssh < username@host> -p < password > ${ANSI.reset} `);
        xtermRef.current.writeln(`${ANSI.error} or: connect - ssh < host > <username> <password>${ANSI.reset}`);
        return;
      }
      xtermRef.current.writeln(`${ANSI.system}[*] Connecting to ${username}@${host}...${ANSI.reset}`);
      setConnectionType('ssh');
      ws.send(JSON.stringify({
        type: 'connect',
        connectionType: 'ssh',
        host,
        username,
        password,
        term: 'xterm-256color',
        debug: true,
        algorithms: {
          kex: ['diffie-hellman-group-exchange-sha1'],
          cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
          hmac: ['hmac-sha1'],
          compress: ['none']
        },
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        readyTimeout: 20000,
        retry: true,
        retryCount: 3,
        forceIPv4: true,
        forceIPv6: false,
        hostHash: 'md5',
        hostVerifier: false,
        strictVendor: false,
        tryKeyboard: true,
        authHandler: ['password'],
        readyTimeout: 30000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        sock: { keepAlive: true, keepAliveInitialDelay: 10000 }
      }));
    }
  },
  {
    name: 'connect -serial',
    handler: async (args, context) => {
      let { xtermRef, setConnectionType, setIsConnected } = context;

      // Check if running in a secure context (HTTPS)
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        xtermRef.current.writeln(`${ANSI.error}[-] Web Serial API requires HTTPS in production${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Please use HTTPS or localhost for development${ANSI.reset}`);
        return;
      }

      // Check browser compatibility
      if (!('serial' in navigator)) {
        xtermRef.current.writeln(`${ANSI.error}[-] Web Serial API not supported in this browser${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Please use Chrome or Edge browser${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Current browser: ${navigator.userAgent}${ANSI.reset}`);
        return;
      }

      try {
        // Close any existing serial connection
        if (context.serialContextRef.current.serialPort) {
          try {
            await context.serialContextRef.current.serialReader.cancel();
            await context.serialContextRef.current.serialWriter.close();
            await context.serialContextRef.current.serialPort.close();
          } catch (e) {
            console.error('Error closing existing port:', e);
          }
        }

        // Request serial port
        const port = await navigator.serial.requestPort({
          filters: [
            { usbVendorId: 0x303A }, // ESP32
            { usbVendorId: 0x1A86 }, // CH340
            { usbVendorId: 0x10C4 }, // CP210x
            { usbVendorId: 0x0403 }  // FTDI
          ]
        });

        // Get port info
        const info = port.getInfo();
        xtermRef.current.writeln(`${ANSI.system}[*] Selected port: ${info.usbVendorId ? `USB (VID:${info.usbVendorId.toString(16)}, PID:${info.usbProductId.toString(16)})` : 'Unknown'}${ANSI.reset}`);

        // Open port with standard settings
        await port.open({
          baudRate: 115200,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          bufferSize: 40000,
          flowControl: 'none'
        });

        xtermRef.current.writeln(`${ANSI.success}[+] Serial port opened at 115200 baud${ANSI.reset}`);

        // Set up reader and writer
        const reader = port.readable.getReader();
        const writer = port.writable.getWriter();

        // Store in context
        context.serialContextRef.current = {
          serialPort: port,
          serialReader: reader,
          serialWriter: writer
        };

        // Set connection state
        setConnectionType('serial');
        setIsConnected(true);

        // Handle serial data reading
        const readSerial = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                xtermRef.current.writeln(`${ANSI.system}[*] Serial port closed${ANSI.reset}`);
                break;
              }
              if (value) {
                const text = new TextDecoder().decode(value);
                const cleanText = text.replace(/[^\x20-\x7E\n\r\t]/g, '');
                if (cleanText) {
                  xtermRef.current.write(cleanText);
                }
              }
            }
          } catch (error) {
            xtermRef.current.writeln(`${ANSI.error}[-] Serial read error: ${error.message}${ANSI.reset}`);
            setIsConnected(false);
            setConnectionType(null);
          } finally {
            reader.releaseLock();
            writer.releaseLock();
            try {
              await port.close();
            } catch (e) {
              console.error('Error closing port:', e);
            }
            context.serialContextRef.current = {
              serialPort: null,
              serialReader: null,
              serialWriter: null
            };
          }
        };

        // Start reading
        readSerial();

        // Send initial newline to trigger response
        await writer.write(new TextEncoder().encode('\r\n'));

      } catch (error) {
        xtermRef.current.writeln(`${ANSI.error}[-] Failed to connect: ${error.message}${ANSI.reset}`);
        if (error.name === 'NotFoundError') {
          xtermRef.current.writeln(`${ANSI.info}[*] No device selected${ANSI.reset}`);
        } else if (error.name === 'SecurityError') {
          xtermRef.current.writeln(`${ANSI.info}[*] Please allow serial port access${ANSI.reset}`);
        }
        setIsConnected(false);
        setConnectionType(null);
      }
    }
  },
  {
    name: 'clear',
    handler: (args, context) => {
      context.xtermRef.current.clear();
    }
  },
  {
    name: 'help',
    handler: (args, context) => {
      let { xtermRef } = context;
      xtermRef.current.writeln(`${ANSI.system}Available commands:${ANSI.reset}`);
      commandRegistry.forEach(cmd => {
        xtermRef.current.writeln(`${ANSI.system}  ${cmd.name}${ANSI.reset}`);
      });
    }
  },
  {
    name: 'info',
    handler: (args, context) => {
      let { xtermRef } = context;
      writeMessage(xtermRef.current, 'info', '[info] This is an info message!');
    }
  },
  {
    name: 'history',
    handler: (args, context) => {
      let { xtermRef, commandHistory } = context;
      xtermRef.current.writeln(`${ANSI.system}Command History:${ANSI.reset}`);
      commandHistory.forEach((cmd, index) => {
        xtermRef.current.writeln(`${ANSI.system}  ${index + 1}  ${cmd}${ANSI.reset}`);
      });
    }
  },
  {
    name: 'echo',
    handler: (args, context) => {
      let { xtermRef } = context;
      const text = args.slice(1).join(' ');
      xtermRef.current.writeln(text);
    }
  },
  {
    name: 'date',
    handler: (args, context) => {
      let { xtermRef } = context;
      const now = new Date();
      xtermRef.current.writeln(now.toLocaleString());
    }
  },
  {
    name: 'pwd',
    handler: (args, context) => {
      let { xtermRef } = context;
      xtermRef.current.writeln('/root');
    }
  },
  {
    name: 'whoami',
    handler: (args, context) => {
      let { xtermRef } = context;
      xtermRef.current.writeln('root');
    }
  },
  {
    name: 'ls',
    handler: (args, context) => {
      let { xtermRef } = context;
      xtermRef.current.writeln(`${ANSI.system}bin  boot  dev  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var${ANSI.reset}`);
    }
  },
  {
    name: 'clear-history',
    handler: (args, context) => {
      let { setCommandHistory } = context;
      setCommandHistory([]);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('commandHistory');
      }
      writeMessage(context.xtermRef.current, 'system', '[*] Command history cleared');
    }
  },
  {
    name: 'serial-info',
    handler: (args, context) => {
      let { xtermRef } = context;

      // Check if running in a secure context (HTTPS)
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        xtermRef.current.writeln(`${ANSI.error}[-] Web Serial API requires HTTPS in production${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Please use HTTPS or localhost for development${ANSI.reset}`);
        return;
      }

      if (!('serial' in navigator)) {
        xtermRef.current.writeln(`${ANSI.error}[-] Web Serial API not supported in this browser${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Please use Chrome or Edge browser${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Current browser: ${navigator.userAgent}${ANSI.reset}`);
        return;
      }

      navigator.serial.getPorts().then(ports => {
        if (ports.length === 0) {
          xtermRef.current.writeln(`${ANSI.info}[*] No serial ports available${ANSI.reset}`);
          return;
        }
        xtermRef.current.writeln(`${ANSI.system}Available Serial Ports:${ANSI.reset}`);
        ports.forEach(port => {
          const info = port.getInfo();
          xtermRef.current.writeln(`${ANSI.info}  - USB (VID:${info.usbVendorId.toString(16)}, PID:${info.usbProductId.toString(16)})${ANSI.reset}`);
        });
      });
    }
  },
  {
    name: 'serial-scan',
    handler: async (args, context) => {
      let { xtermRef } = context;

      // Check if running in a secure context (HTTPS)
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        xtermRef.current.writeln(`${ANSI.error}[-] Web Serial API requires HTTPS in production${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Please use HTTPS or localhost for development${ANSI.reset}`);
        return;
      }

      if (!('serial' in navigator)) {
        xtermRef.current.writeln(`${ANSI.error}[-] Web Serial API not supported in this browser${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Please use Chrome or Edge browser${ANSI.reset}`);
        xtermRef.current.writeln(`${ANSI.info}[*] Current browser: ${navigator.userAgent}${ANSI.reset}`);
        return;
      }

      try {
        const ports = await navigator.serial.getPorts();
        if (ports.length === 0) {
          xtermRef.current.writeln(`${ANSI.info}[*] No serial ports available${ANSI.reset}`);
          return;
        }
        xtermRef.current.writeln(`${ANSI.system}Scanning available ports...${ANSI.reset}`);
        ports.forEach(port => {
          const info = port.getInfo();
          xtermRef.current.writeln(`${ANSI.info}  - Found device: USB (VID:${info.usbVendorId.toString(16)}, PID:${info.usbProductId.toString(16)})${ANSI.reset}`);
        });
      } catch (error) {
        xtermRef.current.writeln(`${ANSI.error}[-] Error scanning available ports: ${error.message}${ANSI.reset}`);
      }
    }
  },
  {
    name: 'serial-reset',
    handler: async (args, context) => {
      let { xtermRef, setConnectionType, setIsConnected } = context;
      try {
        if (context.serialContextRef.current.serialPort) {
          try {
            await context.serialContextRef.current.serialReader.cancel();
            await context.serialContextRef.current.serialWriter.close();
            await context.serialContextRef.current.serialPort.close();
            xtermRef.current.writeln(`${ANSI.system}[*] Closed port: ${context.serialContextRef.current.serialPort.getInfo().usbVendorId.toString(16)}${ANSI.reset}`);
          } catch (error) {
            xtermRef.current.writeln(`${ANSI.error}[-] Error closing port: ${error.message}${ANSI.reset}`);
          }
        }
        context.serialContextRef.current = {
          serialPort: null,
          serialReader: null,
          serialWriter: null
        };
        setIsConnected(false);
        setConnectionType(null);
        xtermRef.current.writeln(`${ANSI.success}[+] All serial ports reset${ANSI.reset}`);
      } catch (error) {
        xtermRef.current.writeln(`${ANSI.error}[-] Error resetting ports: ${error.message}${ANSI.reset}`);
      }
    }
  }
];

function writeAsciiArt(term) {
  const art = `      \\                 \\
       \\         ..      \\
        \\       /  \`-.--.___ __.-.___
\`-.      \\     /  #   \`-._.-'    \\   \`--.__
   \`-.        /  ####    /   ###  \\        \`.
________     /  #### ############  |       _|           .'
            |\\ #### ##############  \\__.--' |    /    .'
            | ####################  |       |   /   .'
            | #### ###############  |       |  /
            | #### ###############  |      /|      ----
          . | #### ###############  |    .'<    ____
        .'  | ####################  | _.'-'\\|
      .'    |   ##################  |       |
             \`.   ################  |       |
               \`.    ############   |       | ----
              ___\`.     #####     _..____.-'     .
             |\`-._ \`-._       _.-'    \\\\\\         \`.
          .'\`-._  \`-._ \`-._.-'\`--.___.-' \\          \`.
        .' .. . \`-._  \`-._        ___.---'|   \\   \\
      .' .. . .. .  \`-._  \`-.__.-'        |    \\   \\
     |\`-. . ..  . .. .  \`-._|             |     \\   \\
     |   \`-._ . ..  . ..   .'            _|
      \`-._   \`-._ . ..   .' |      __.--'
          \`-._   \`-._  .' .'|__.--'
              \`-._   \`' .'
                  \`-._.'`;

  term.writeln(`${ANSI.art}${art}${ANSI.reset}`);
}

export default function Home() {
  // Add viewport meta tag to prevent zooming
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(meta);
    }
  }, []);

  const [command, setCommand] = useState('');
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInteractive, setIsInteractive] = useState(false);
  const [interactiveCommand, setInteractiveCommand] = useState('');
  const [connectionType, setConnectionType] = useState(null);
  const [commandHistory, setCommandHistory] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedHistory = localStorage.getItem('commandHistory');
      return savedHistory ? JSON.parse(savedHistory) : [];
    }
    return [];
  });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [lastTapTime, setLastTapTime] = useState(0);
  const [lastTapPosition, setLastTapPosition] = useState({ x: 0, y: 0 });
  const serialContextRef = useRef({
    serialPort: null,
    serialReader: null,
    serialWriter: null
  });
  const processedMessages = useRef(new Set());

  // Initialize terminal and websocket
  useEffect(() => {
    let term, fitAddon, webLinksAddon, websocket;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 2000;

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    const connectWebSocket = () => {
      // Use secure WebSocket for HTTPS
      const wsUrl = window.location.protocol === 'https:'
        ? 'wss://209.38.123.74:3001'
        : 'ws://209.38.123.74:3001';

      websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        reconnectAttempts = 0;
        term.writeln(`${ANSI.art}[<3] PWNING YOUR SYSTEM WITH LOVE ${ANSI.reset}`);
        writeMessage(term, 'system', '[*] Connected to server');
        setIsConnected(true);
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);

        // Skip if we've already processed this message ID
        if (data.id && processedMessages.current.has(data.id)) {
          return;
        }
        if (data.id) {
          processedMessages.current.add(data.id);
          // Limit stored IDs to prevent memory growth
          if (processedMessages.current.size > 1000) {
            const firstId = processedMessages.current.values().next().value;
            processedMessages.current.delete(firstId);
          }
        }

        switch (data.type) {
          case 'status':
            if (data.status === 'connected') {
              setIsConnected(true);
              if (connectionType === 'ssh') {
                writeMessage(term, 'success', '[+] SSH connection established');
              } else if (connectionType === 'serial') {
                writeMessage(term, 'success', '[+] Serial connection established');
              }
            } else if (data.status === 'disconnected') {
              setIsConnected(false);
              setConnectionType(null);
              setIsInteractive(false);
              setInteractiveCommand('');
              writeMessage(term, 'system', '[*] Connection closed');
            } else if (data.status === 'debug') {
              writeMessage(term, 'info', `[*] Debug: ${data.message}`);
            }
            break;
          case 'output':
            if (xtermRef.current) {
              // Filter out prompt lines
              const lines = data.data.split(/\r?\n/);
              const filtered = lines.filter(line => !/^(\x1B\[.*?m)?(┌──\(.*?\)-\[.*?\]|└─# ?)$/.test(line.trim()));
              if (filtered.length > 0) {
                xtermRef.current.write(filtered.join('\n'));
              }
            }
            break;
          case 'error':
            writeMessage(term, 'error', `[-] ${data.message || data.data}`);
            if (data.debug) {
              writeMessage(term, 'info', `[*] Debug info: ${JSON.stringify(data.debug, null, 2)}`);
            }
            break;
          case 'interactive_prompt':
            term.write('\r\n' + data.prompt);
            break;
          case 'interactive_output':
            term.write(data.data);
            break;
          case 'pty_data':
            term.write(data.data);
            break;
          case 'command':
            handleCommand(data.command);
            break;
        }
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        writeMessage(term, 'error', '[-] WebSocket connection error');
      };

      websocket.onclose = () => {
        writeMessage(term, 'system', '[*] Disconnected from server');
        setIsConnected(false);
        setConnectionType(null);
        setIsInteractive(false);
        processedMessages.current.clear();

        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          writeMessage(term, 'info', `[*] Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);
          setTimeout(connectWebSocket, reconnectDelay);
        } else {
          writeMessage(term, 'error', '[-] Max reconnection attempts reached');
        }
      };

      setWs(websocket);
    };

    async function loadTerminal() {
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      const { WebLinksAddon } = await import('xterm-addon-web-links');
      await import('xterm/css/xterm.css');

      term = new Terminal({
        cursorBlink: false,
        cursorStyle: 'block',
        fontSize: 10,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#030506',
          foreground: '#A5AAAD',
        },
        scrollback: 5000,
        convertEol: true,
        rendererType: 'canvas',
        allowTransparency: true,
        cols: 100,
        rows: 30,
        lineHeight: 1.2,
        wordWrap: true,
        wordWrapMode: 'word'
      });

      term.options.cursorBlink = false;

      if (typeof window !== 'undefined') {
        const style = document.createElement('style');
        style.innerHTML = `
  .xterm .xterm-cursor,
  .xterm .xterm-cursor-block,
  .xterm .xterm-cursor-bar,
  .xterm .xterm-cursor-underline,
  .xterm .xterm-cursor-layer {
    opacity: 0 !important;
          }
  .xterm-viewport::-webkit-scrollbar {
    display: none;
          }
  .xterm-viewport {
    scrollbar - width: none;
  -ms-overflow-style: none;
          }
  `;
        document.head.appendChild(style);
      }

      fitAddon = new FitAddon();
      webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      if (terminalRef.current) {
        term.open(terminalRef.current);
        fitAddon.fit();
      }

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      writeAsciiArt(term);

      window.addEventListener('resize', handleResize);

      connectWebSocket();

      term.onKey(({ key, domEvent }) => {
        domEvent.preventDefault();
        return;
      });
    }

    loadTerminal();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (websocket) websocket.close();
      if (term) term.dispose();
    };
  }, []);

  // Handle sending interactive input data from terminal
  useEffect(() => {
    if (!xtermRef.current || !ws) return;

    const term = xtermRef.current;

    const handleData = (data) => {
      console.log('Terminal data received:', data);
      if ((isInteractive || connectionType === 'serial') && ws.readyState === WebSocket.OPEN) {
        if (connectionType === 'serial') {
          term.write(data);
        }
        ws.send(JSON.stringify({
          type: 'pty_data',
          data: data,
          connectionType: connectionType
        }));
      }
    };

    const disposable = term.onData(handleData);

    return () => {
      disposable.dispose();
    };
  }, [isInteractive, ws, connectionType]);

  // Save command history to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('commandHistory', JSON.stringify(commandHistory));
    }
  }, [commandHistory]);

  const getCommandSuggestions = (input) => {
    if (!input) return [];
    const lowerInput = input.toLowerCase();

    const prefixMatches = commandRegistry.filter(cmd => cmd.name.toLowerCase().startsWith(lowerInput));
    const substringMatches = commandRegistry.filter(cmd =>
      !cmd.name.toLowerCase().startsWith(lowerInput) && cmd.name.toLowerCase().includes(lowerInput)
    );

    const historyMatches = commandHistory.filter(cmd =>
      cmd.toLowerCase().startsWith(lowerInput) || cmd.toLowerCase().includes(lowerInput)
    );

    const allSuggestions = [
      ...prefixMatches.map(cmd => cmd.name),
      ...substringMatches.map(cmd => cmd.name),
      ...historyMatches
    ];

    return [...new Set(allSuggestions)];
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setCommand(newValue);
    setHistoryIndex(-1);
    const suggs = getCommandSuggestions(newValue);
    setSuggestions(suggs);
    setSelectedSuggestion(0);
  };

  const handleKeyPress = (e) => {
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      setIsSearching(true);
      setSearchQuery('');
      setSearchResults([]);
      setSearchIndex(-1);
      return;
    }

    if (isSearching) {
      if (e.key === 'Escape') {
        setIsSearching(false);
        setSearchQuery('');
        setSearchResults([]);
        setSearchIndex(-1);
        return;
      }

      if (e.key === 'Enter' && searchResults.length > 0) {
        setCommand(searchResults[searchIndex]);
        setIsSearching(false);
        setSearchQuery('');
        setSearchResults([]);
        setSearchIndex(-1);
        return;
      }

      if (e.key === 'ArrowUp' && searchResults.length > 0) {
        e.preventDefault();
        setSearchIndex(prev => (prev + 1) % searchResults.length);
        return;
      }

      if (e.key === 'ArrowDown' && searchResults.length > 0) {
        e.preventDefault();
        setSearchIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
        return;
      }
    }

    if (e.key === 'Enter') {
      if (command.trim()) {
        setCommandHistory(prev => [...prev, command]);
        setHistoryIndex(-1);
      }
      handleCommand(command);
      setCommand('');
      setSuggestions([]);
      setSelectedSuggestion(0);
    } else if (e.key === 'Tab') {
      if (suggestions.length > 0) {
        e.preventDefault();
        setCommand(suggestions[selectedSuggestion]);
        setSuggestions([]);
        setSelectedSuggestion(0);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
        setSuggestions([]);
        setSelectedSuggestion(0);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setCommand('');
        } else {
          setHistoryIndex(newIndex);
          setCommand(commandHistory[newIndex]);
        }
        setSuggestions([]);
        setSelectedSuggestion(0);
      }

    }
  };

  const handleCommand = (cmd) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (xtermRef.current) {
        writeMessage(xtermRef.current, 'error', '[-] Not connected to server');
      }
      return;
    }

    const args = cmd.trim().split(' ');
    const baseCommand = args[0].toLowerCase();

    const actualCommand = commandAliases[baseCommand] || baseCommand;
    args[0] = actualCommand;

    if (actualCommand === 'connect' && args[1]) {
      const connectType = args[1].toLowerCase();
      const found = commandRegistry.find(cmdObj => cmdObj.name === `connect ${connectType}`);

      if (found) {
        found.handler(args, {
          ws,
          xtermRef,
          setIsInteractive,
          setInteractiveCommand,
          setCommandHistory,
          commandHistory,
          setConnectionType,
          setIsConnected,
          serialContextRef
        });
        return;
      }
    }

    const found = commandRegistry.find(cmdObj => actualCommand === cmdObj.name.split(' ')[0]);

    if (found) {
      found.handler(args, {
        ws,
        xtermRef,
        setIsInteractive,
        setInteractiveCommand,
        setCommandHistory,
        commandHistory,
        setConnectionType,
        setIsConnected,
        serialContextRef
      });
      return;
    }

    if (connectionType === 'serial') {
      xtermRef.current.writeln(cmd);

      if (serialContextRef.current.serialWriter) {
        const command = cmd + '\r\n';
        serialContextRef.current.serialWriter.write(new TextEncoder().encode(command))
          .then(() => {
            xtermRef.current.writeln(`${ANSI.info}[*] Command sent: ${cmd}${ANSI.reset}`);
          })
          .catch(error => {
            console.error('Command write error:', error);
            xtermRef.current.writeln(`${ANSI.error}[-] Write error: ${error.message}${ANSI.reset}`);
          });
      } else {
        xtermRef.current.writeln(`${ANSI.error}[-] Serial writer not available${ANSI.reset}`);
      }
    } else if (isConnected) {
      ws.send(JSON.stringify({
        type: 'command',
        command: cmd,
        connectionType: connectionType
      }));
    } else {
      writeMessage(xtermRef.current, 'error', '[-] Not connected. Use "connect -ssh" or "connect -serial" to establish connection');
    }
  };

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Received WebSocket message:', data);

      // Skip if we've already processed this message ID
      if (data.id !== undefined && processedMessages.current.has(data.id)) {
        console.log('Skipping duplicate message:', data.id);
        return;
      }
      if (data.id !== undefined) {
        processedMessages.current.add(data.id);
        // Limit stored IDs to prevent memory growth
        if (processedMessages.current.size > 1000) {
          const firstId = processedMessages.current.values().next().value;
          processedMessages.current.delete(firstId);
        }
      }

      switch (data.type) {
        case 'output':
          if (xtermRef.current) {
            // Filter out prompt lines
            const lines = data.data.split(/\r?\n/);
            const filtered = lines.filter(line => !/^(\x1B\[.*?m)?(┌──\(.*?\)-\[.*?\]|└─# ?)$/.test(line.trim()));
            if (filtered.length > 0) {
              xtermRef.current.write(filtered.join('\n'));
            }
          }
          break;
        case 'error':
          if (xtermRef.current) {
            writeMessage(xtermRef.current, 'error', data.message || data.data);
          }
          break;
        case 'status':
          if (data.status === 'connected') {
            setIsConnected(true);
            if (connectionType === 'ssh') {
              writeMessage(xtermRef.current, 'success', '[+] SSH connection established');
            } else if (connectionType === 'serial') {
              writeMessage(xtermRef.current, 'success', '[+] Serial connection established');
            }
          } else if (data.status === 'disconnected') {
            setIsConnected(false);
            setConnectionType(null);
            setIsInteractive(false);
            setInteractiveCommand('');
            writeMessage(xtermRef.current, 'system', '[*] Connection closed');
          }
          break;
        case 'command':
          handleCommand(data.command);
          break;
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, connectionType]);

  useEffect(() => {
    if (isSearching && searchQuery) {
      const results = commandHistory.filter(cmd =>
        cmd.toLowerCase().includes(searchQuery.toLowerCase())
      ).reverse();
      setSearchResults(results);
      setSearchIndex(results.length > 0 ? 0 : -1);
    }
  }, [searchQuery, isSearching]);

  const handleTouchStart = (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;
    const touch = e.touches[0];
    const currentPosition = { x: touch.clientX, y: touch.clientY };

    if (tapLength < 300 && tapLength > 0) {
      const distance = Math.sqrt(
        Math.pow(currentPosition.x - lastTapPosition.x, 2) +
        Math.pow(currentPosition.y - lastTapPosition.y, 2)
      );

      if (distance < 50) {
        if (suggestions.length > 0) {
          setCommand(suggestions[selectedSuggestion]);
          setSuggestions([]);
          setSelectedSuggestion(0);
        }
      }
    }

    setLastTapTime(currentTime);
    setLastTapPosition(currentPosition);
  };

  return (
    <main className="flex flex-col justify-between w-[100vw] h-[100vh] bg-[#030506] relative overflow-hidden">
      <div className="flex-1 overflow-hidden pb-24 py-4">
        <div ref={terminalRef} className="w-full h-full px-4 py-2" style={{ touchAction: 'none' }} />
      </div>
      <div className="text-[#B294BB] border-t border-[#282E2F] px-4 py-4 fixed bottom-0 left-0 right-0 bg-[#030506] z-50">
        <div className="flex items-center relative">
          <span className="mr-2 whitespace-nowrap">~</span>
          <div className="relative w-full text-sm">
            {isSearching && (
              <div className="absolute -top-6 left-0 text-[#B294BB]">
                (reverse-i-search)`{searchQuery}': {searchResults[searchIndex] || ''}
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              value={isSearching ? searchQuery : command}
              onChange={(e) => isSearching ? setSearchQuery(e.target.value) : handleInputChange(e)}
              onKeyDown={handleKeyPress}
              onTouchStart={handleTouchStart}
              className="bg-transparent border-none outline-none text-[#C495D0] w-full relative z-10 break-all"
              placeholder={command ? "" : "Enter command..."}
              spellCheck="false"
              autoComplete="off"
              style={{
                minWidth: '100%',
                width: 'auto',
                maxWidth: '100%',
                wordBreak: 'break-all',
                overflowWrap: 'break-word',
                touchAction: 'none'
              }}
            />
            {suggestions.length > 0 && command && suggestions[0] !== command && (
              <div
                className="absolute top-0 left-0 w-full text-[#B294BB] opacity-30 pointer-events-none break-all"
                style={{
                  textShadow: 'none',
                  background: 'transparent',
                  wordBreak: 'break-all',
                  overflowWrap: 'break-word'
                }}
              >
                {suggestions[0]}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
