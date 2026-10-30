# workflow-runner (framework connector)

Implements `workflow.run/v1`: the stage cursor for project workflows (`workflows.<name>` in
agentbay.config.yaml). It keeps run state in `.agentbay/data/workflows/`, which nothing else writes, and hands
each stage back as a `<mode>.<endpoint>` call for the coordinator to make. It never calls an endpoint itself,
never spawns an agent and never reads connector data. The root mode `cos` uses it.
