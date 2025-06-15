/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    async rewrites() {
        return [
            {
                source: '/ws',
                destination: 'https://localhost:3002/ws',
            },
        ]
    },
}

module.exports = nextConfig 