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

# Start the application with PM2
pm2 start server.js --name "pwn0gotchi-server"
pm2 start npm --name "pwn0gotchi-next" -- start

# Setup PM2 to start on boot
pm2 startup
pm2 save

# Install Certbot if not already installed
if ! command -v certbot &> /dev/null; then
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
fi

# Configure Nginx
cat > /etc/nginx/sites-available/pwn0gotchi << 'EOF'
server {
    listen 80;
    listen 443 ssl;
    server_name 209.38.123.74;

    # SSL configuration will be added by Certbot

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/pwn0gotchi /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Obtain SSL certificate
certbot --nginx -d 209.38.123.74 --non-interactive --agree-tos --email your-email@example.com

# Restart Nginx
systemctl restart nginx

# Configure firewall
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables-save > /etc/iptables/rules.v4

echo "Deployment complete! Your application should be running at https://209.38.123.74" 