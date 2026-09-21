# nginx release notes

## 1.27.3

### What's new

Adds a directive for controlling the worker shutdown timeout.

### Bugfixes

Fixed a crash when reloading with an empty `upstream` block.

## 1.27.2

### What's new

Adds QUIC datagram support behind a build flag.

### Known issues

The datagram feature is not yet stable for production use.
