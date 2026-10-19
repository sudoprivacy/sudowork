# Public WebUI asset delivery

The production SPA entry module can exceed 5 MB before compression. Sending it
uncompressed with `Cache-Control: no-store` forced every phone refresh to repeat
the transfer and caused real browser acceptance to exceed its navigation limit.

Mount `static-cache.conf` as `/etc/nginx/conf.d/00-static-cache.conf` and include
`static-assets.conf` inside the existing WebUI server block. The default upstream
is the Compose service `webui:26808`. Keep the existing root, API, WebSocket and
TLS configuration unchanged.

The asset publisher rejects changed bytes under an existing asset name and
retains prior release assets. Successful `/assets/` responses can therefore use
an immutable cache policy. Missing assets remain `no-store`; HTML and API routes
keep the application's `no-store` policy. Compression is restricted to public
assets and varies by `Accept-Encoding`.

Validate `nginx -t` and use a temporary gateway against the real packaged server
before changing the production listener. Single-file Docker bind mounts retain
their original inode after a host file is replaced. Compare the mounted and host
configuration hashes; recreate the gateway when they differ. A reload alone
cannot load the replacement file through a stale bind mount.

Keep bind-mount source files in a durable deployment directory. Files copied to
a staging directory become live configuration once a gateway mounts them; keep
that directory until the gateway has been replaced and no active mount uses it.
