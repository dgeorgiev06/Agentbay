# forge (framework mode)

Builds agentbay itself.

- `forge.create` scaffolds a mode, feature, connector or env (the same templates as `bay new <kind>`, through
  the `scaffold` connector) and has the builder fill it in env `local-authoring`, which writes `modes/`,
  `envs/`, `connectors/` and the config only, with review.
- `forge.extend` changes the framework: proposal -> your approval -> implement -> mandatory deep review ->
  release, in env `framework-dev`; lint refuses a weaker review. It is installed only when the project is the
  agentbay checkout.

Templates for scaffolds are in `templates/`.
