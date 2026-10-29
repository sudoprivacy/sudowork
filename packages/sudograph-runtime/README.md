# Sudograph host runtime

The same compiler client and registered PostgreSQL/MySQL provider used by
SudoWork Desktop, available to ordinary Node hosts. This package has no Electron,
renderer, RDF model, UI connector catalogue or private workspace dependency.
The existing Desktop and ontology-runtime modules re-export these constructors.

Deploy a verified, pinned `sudograph-compiler` wheel in a dedicated Python
environment. Construct `SudographModelClient` with that interpreter, an empty
operator-owned working directory and private canonical model storage. The host
resolves the model reference, authenticated actor and registered source; clients
and model submissions must not select worker paths, credentials or grants.

The source configuration is a transport contract. Existing SudoWork connector
inputs can supply these fields directly. Passwords remain host-only and never
become model YAML, generated graphs or prompts. Provider reads remain bounded,
read-only operations through the existing compiler protocol.

Build with `bun run build` and pack with `bun pm pack`. Both compiled Node
exports and Bun source exports are included. Release adoption must verify the
archive hash and freeze dependencies. Installation does not register a model,
grant tenant or record access, connect a cloud agent or establish WebUI review.
