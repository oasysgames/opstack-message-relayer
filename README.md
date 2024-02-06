# message-relayer
Opstack message relayer developed using sdk

# Help
```sh
npx tsx ./src/service.ts -h
```

# API
```sh
# health check
curl http://127.0.0.1:7300/healthz | jq

# show status
curl http://127.0.0.1:7300/api/status | jq

# Metrics
curl http://127.0.0.1:7300/metrics
```
