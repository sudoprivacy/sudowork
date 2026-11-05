# Sudograph host runtime

The same compiler client, registered PostgreSQL/MySQL provider and review
transport used by
SudoWork Desktop, available to ordinary Node hosts. Its runtime constructors are
independent of Electron, RDF storage and private workspace dependencies.
The existing Desktop and ontology-runtime modules re-export these constructors.

`SudographReviewHost` and `ShareoneReviewAssets` provide the existing authenticated
loopback review transport and checksum-checked ShareOne shell loader. Hosts inject
current authorization, canonical reads and comment delivery; this package creates
no tenant authority, credential store or comment registry. Desktop re-exports the
same classes. Cloud hosts must supply their existing current-user policy and
authenticated browser handoff rather than treating a local cookie as a tenant
grant. Launch credentials remain non-enumerable and out of URLs and JSON.

The published runtime includes `review-assets/`, built from the same pinned
ShareOne source as Desktop. It contains the original frontend, its file integrity
manifest and source receipt; it contains no comments, model, customer records or
credentials. Use `ShareoneReviewAssets.load` with this installed directory. A
host that bundles JavaScript into another file or executable must copy that
directory into its own deployment resources and pass the deployed path to the
same loader. Hosts do not build or maintain a second comment interface.

Before packing, run `node scripts/prepare-sudograph-review-assets.mjs` in the
source checkout. It reuses Desktop's pinned frontend builder and verifies every
asset through the shared loader. The release and Windows/Linux installed-package
acceptance workflows provide the existing dedicated read-only ShareOne deploy
key. Package acceptance refuses a missing or mismatched source receipt, loads
the frontend from the archive installed outside the checkout, and verifies that
corruption is rejected. Publishing still requires the accepted source and matching
package version; a generated local directory alone is not an accepted release.

Cloud hosts can mount the same `handleRequest` on their existing HTTP server
using an explicit `embedded.origin` and `ISudographReviewGrantStore`. Public
origins require HTTPS; HTTP is accepted only for literal loopback addresses.
The package starts no extra listener in this mode. The existing managed browser
handoff derives Secure from the verified HTTPS URL, rather than accepting another
caller-selected cookie field. It installs the private, path-scoped HttpOnly credential;
it must not expose the launch through an agent/renderer message or ordinary URL.

The host-owned grant store must atomically create unique IDs, enforce capacity,
expire grants and compare immutable identity before metadata updates. Store only
the credential hash, binding and expiry, plus comment connection/render revision
metadata. Reads must reflect current shared state, without an instance-local
authorization cache. Independent instances may serve the same grant; closing one
instance does not revoke every other instance's grants. Explicit `revoke()` may
be asynchronous and must be awaited. Every response still checks current host
authorization and grant state; a store outage refuses the response. Read callbacks
receive the conversation binding as their third argument so multi-user hosts
can resolve current durable ownership without an ambient active conversation.
Multi-user hosts must supply an opaque `authorizationRef` derived from their
durable ownership and project generation. `authorize` must return the current
reference after checking current access; the host rejects a missing or mismatched
return value. It is not the editable model revision: ordinary model changes
keep the grant usable, while ownership replacement or disable/re-enable cycles
can invalidate it. Current membership and source policy are still rechecked.

`SudographReviewComments` is the same private ShareOne comment and reply service
used by Desktop. Hosts supply `ISudographReviewStore`, current authorization,
their existing credential resolver and ordinary conversation delivery. Store
operations may be synchronous or asynchronous; the service awaits durable event
commits before acknowledging the ShareOne cursor and awaits input claims before
starting a turn. Host stores must enforce the documented atomicity and uniqueness
contracts. No model, comment content registry, database driver or credential
storage is created by this package. Delivery status is asynchronous as well.

Before dispatch, `claimReviewDelivery` must atomically reserve the inbox item in
durable storage. A reservation is permanent, not an expiring execution lease.
Another controller or a restarted host must inspect the existing conversation;
it cannot submit the same input again because a process-local message lookup is
empty. Optional `recover` returns a pending, completed or unknown outcome from
that conversation. Completed outcomes can retry the provider reply; unknown
outcomes remain visible as requiring recovery and never authorize another turn.
Head reads include the actual conversation ID for current host authorization.

Deploy a verified, pinned `sudograph-compiler` wheel in a dedicated Python
environment. Construct `SudographModelClient` with that interpreter, an empty
operator-owned working directory and private canonical model storage. The host
resolves the model reference, authenticated actor and registered source; clients
and model submissions must not select worker paths, credentials or grants.

The source configuration is a transport contract. Existing SudoWork connector
inputs can supply these fields directly. Passwords remain host-only and never
become model YAML, generated graphs or prompts. Provider reads remain bounded,
read-only operations through the existing compiler protocol.

Build the workspace packages, prepare the pinned review assets and use the
installed-package acceptance command before publishing. Compiled Node exports,
Bun source exports and the original review frontend are included. Adoption must verify the
archive hash and freeze dependencies. Installation does not register a model,
grant tenant or record access, connect a cloud agent or establish WebUI review.
