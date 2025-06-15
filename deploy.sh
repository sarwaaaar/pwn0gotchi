#!/bin/bash

# Stop any existing PM2 processes
pm2 stop all
pm2 delete all
pm2 unstartup

# Remove existing directory
rm -rf /var/www/pwn0gotchi

# Create fresh directory
mkdir -p /var/www/pwn0gotchi
cd /var/www/pwn0gotchi

# Clone the repository
git clone https://github.com/sarwaaaar/pwn0gotchi .

# Install dependencies
npm install

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
pm2 start server.js --name "pwn0gotchi-server"
pm2 start npm --name "pwn0gotchi-next" -- start

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

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass https://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
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

echo "Deployment complete! Your application should be running at https://209.38.123.74"
echo "Note: You're using a self-signed certificate. Your browser will show a security warning."
echo "To proceed, you'll need to accept the security warning in your browser." 