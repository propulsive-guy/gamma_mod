/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        serverActions: {
            // Profile saves may contain both a new logo and a new cover image.
            bodySizeLimit: '5mb',
        },
    },
};

export default nextConfig;
