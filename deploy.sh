#!/bin/bash

# Stop any existing PM2 processes
pm2 stop all
pm2 delete all
pm2 unstartup

# Kill any processes using ports 3000, 3001, and 3002
fuser -k 3000/tcp 2>/dev/null
fuser -k 3001/tcp 2>/dev/null
fuser -k 3002/tcp 2>/dev/null

# Additional cleanup for Node.js processes
pkill -f "node.*server.js" 2>/dev/null
pkill -f "node.*next" 2>/dev/null

# Remove existing directory
rm -rf /var/www/pwn0gotchi

# Create fresh directory
mkdir -p /var/www/pwn0gotchi
cd /var/www/pwn0gotchi

# Clone the repository
git clone https://github.com/sarwaaaar/pwn0gotchi .

# Install dependencies
npm install
npm install express ws cors serialport @serialport/parser-readline ssh2

# Build the Next.js application
npm run build

# Create SSL directory if it doesn't exist
mkdir -p /etc/nginx/ssl

# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/pwn0gotchi.key \
  -out /etc/nginx/ssl/pwn0gotchi.crt \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=209.38.123.74"

# Set proper permissions for SSL certificates
chmod 644 /etc/nginx/ssl/pwn0gotchi.crt
chmod 600 /etc/nginx/ssl/pwn0gotchi.key
chown -R root:root /etc/nginx/ssl

# Start the application with PM2
cd /var/www/pwn0gotchi

# Start Next.js first
PORT=3000 pm2 start npm --name "pwn0gotchi-next" -- start

# Wait for Next.js to start
sleep 10

# Start the WebSocket server with environment variables
PORT=3001 WS_PORT=3002 pm2 start server.js --name "pwn0gotchi-server" --time

# Setup PM2 to start on boot
pm2 startup
pm2 save

# Configure Nginx
cat > /etc/nginx/sites-available/pwn0gotchi << 'EOF'
server {
    listen 80;
    server_name 209.38.123.74;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name 209.38.123.74;

    ssl_certificate /etc/nginx/ssl/pwn0gotchi.crt;
    ssl_certificate_key /etc/nginx/ssl/pwn0gotchi.key;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Increase max body size
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass https://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific settings
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 86400;
        
        # Allow all origins for WebSocket
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;
        add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range' always;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/pwn0gotchi /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx

# Configure firewall
mkdir -p /etc/iptables
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables-save > /etc/iptables/rules.v4

# Check if services are running
echo "Checking service status..."
pm2 status
systemctl status nginx

echo "Deployment complete! Your application should be running at https://209.38.123.74"
echo "Note: You're using a self-signed certificate. Your browser will show a security warning."
echo "To proceed, you'll need to accept the security warning in your browser." 