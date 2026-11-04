# {{name}}

{{intent}}

**Contract:** implements `{{implements}}`. TODO the hosts it calls and the secrets it needs.

**HTTP and secrets:** all HTTP goes through `ctx.http`, which enforces the allowlist before the request. Secrets
come only through `ctx.secrets.get(NAME)`; never print or log them.

## Setup

TODO the secrets to store (`bay secret set <NAME>`) and the env binding (`{{implements}}: [{{name}}]`).
**Settings:** none (declare `config:` in connector.yaml and add a `config.example.yaml` if it takes any).
