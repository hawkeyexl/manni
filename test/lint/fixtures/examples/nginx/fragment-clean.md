This directive enables persistent connections between nginx and the
upstream server named in `proxy_pass`.

```nginx
proxy_http_version 1.1;
proxy_set_header Connection "";
```
