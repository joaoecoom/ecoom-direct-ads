module.exports = {
  apps: [
    {
      name: "ecoom-ads-api",
      script: "server/index.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 8787,
      },
    },
  ],
};
