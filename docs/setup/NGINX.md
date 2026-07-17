# NGINX - Example Configuration

> **Note:** This configuration is set up manually on the server when the MVP is
> ready. It is kept here as a reference.

## Starting Point

The following nginx configuration is an example reverse-proxy setup for
`managed-skill-hub`:

- API runs locally on port `3040`.
- Web frontend runs locally on port `3041`.
- All requests under `/api` are forwarded to the backend.
- All other requests go to the frontend.
- HTTPS uses certificates trusted by the target clients.

## Example `managed-skill-hub`

Define shared request and connection zones once in the nginx `http` context.
These limits are enforced across nginx workers. Adjust them to expected traffic
before production rollout:

```nginx
limit_req_zone $binary_remote_addr zone=managed_skill_hub_api:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=managed_skill_hub_connections:10m;
```

```nginx
server {
    listen 80;
    server_name managed-skill-hub.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name managed-skill-hub.example.com;

    large_client_header_buffers 4 16k;
    proxy_buffer_size 16k;
    proxy_buffers 8 16k;
    proxy_busy_buffers_size 64k;
    charset UTF-8;

    include /etc/nginx/conf.d/include_ssl;
    ssl_certificate             /etc/ssl/your-domain/fullchain.pem;
    ssl_certificate_key         /etc/ssl/your-domain/key.pem;
    ssl_trusted_certificate     /etc/ssl/your-domain/ca.pem;

    access_log /var/log/nginx/access/managed-skill-hub.log ecs_json;
    error_log /var/log/nginx/error/managed-skill-hub.log;

    location ~ ^/api {
        # Keep this slightly above PROPOSAL_MAX_FILE_SIZE_BYTES to allow
        # multipart framing while rejecting oversized bodies at the edge.
        client_max_body_size 12m;
        limit_req zone=managed_skill_hub_api burst=40 nodelay;
        limit_req_status 429;
        limit_conn managed_skill_hub_connections 20;

        proxy_pass http://127.0.0.1:3040;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
    }

    location / {
        proxy_pass http://127.0.0.1:3041;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg)$ {
        proxy_pass http://127.0.0.1:3041;
        proxy_cache_valid 200 1d;
        add_header Cache-Control "public, max-age=86400";
    }
}
```

When nginx connects locally as shown above, configure the API with:

```env
API_TRUSTED_PROXIES=127.0.0.1,::1
```

Do not set `API_TRUSTED_PROXIES` to broad public networks. Fastify uses this
allowlist to decide whether `X-Forwarded-For` may determine `request.ip`, which
is also the unauthenticated proposal rate-limit key. The API's in-memory limiter
is process-local; keep the nginx/API-gateway limits enabled for multi-process or
multi-instance deployments.

## Manual Server Setup

```bash
ssh deploy@your-server.example.com
sudo tee /etc/nginx/sites-available/managed-skill-hub > /dev/null <<'NGINX'
# ... configuration from above ...
NGINX

sudo ln -sf /etc/nginx/sites-available/managed-skill-hub /etc/nginx/sites-enabled/managed-skill-hub
sudo nginx -t
sudo systemctl reload nginx
```

## Open Points Before Activation

- Decide the final hostname.
- Verify correct IP and ports.
- Verify SSL certificate paths.
- Align API port and frontend port in `.env`.
- Consider additional admin-path protection later through authentik.

## Single-Host Setup

When frontend and API should run under the same domain, set `API_PREFIX=/api`
in the API server and configure nginx to forward all `/api/*` requests to the
API server. The frontend then calls `/api` directly: no CORS and no separate
port exposure.

## Example: Frontend And API Under One Host

```nginx
server {
    listen 80;
    server_name skillhub.example.com;

    location /api/ {
        proxy_pass http://127.0.0.1:3040/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        root /path/to/deploy-root/src/apps/web/dist;
        try_files $uri $uri/ /index.html;
    }
}
```

Important `.env` values for this setup:

```bash
# .env
API_PREFIX=/api

# .env
VITE_API_BASE_URL=/api
VITE_USE_API_PROXY=false
```
