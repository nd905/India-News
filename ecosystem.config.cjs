module.exports = {
  apps: [
    {
      name: 'india-news',
      script: 'npx',
      args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000 --binding CONSUMER_KEY=h814saSbcejsJEZ0NF3Z7u3YS --binding CONSUMER_SECRET=YEFQVVrqDV3VWJU2eNGsYOs4zVQPkve1AKJky4JRXzY8WF0Rjp --binding ACCESS_TOKEN=596210221-yrSJM4qDu0MQ46r0DQ4YtxIS7JPnkKzTQOChHvt8 --binding ACCESS_TOKEN_SECRET=yGRkI9saAAhczcd9Q0eiBRV9Hz7wLdeR3yzHYzXQOoHAk --binding NEWS_API_KEY=0f761fbbe8cb45dab9bac756f369ba88',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
