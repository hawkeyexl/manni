# Enable HTTP/2 on an existing server block

## Overview

Turn on HTTP/2 for a site that already terminates TLS.

## Before you begin

A working TLS certificate and a server block that already listens on 443.

## Edit the listen directive

Add `http2` after the `ssl` parameter on the `listen` line.

```nginx
listen 443 ssl http2;
```

## Reload nginx

```nginx
nginx -s reload
```

## Troubleshooting

If the browser falls back to HTTP/1.1, confirm the client supports ALPN.

## See also

The `http2` module reference.
