# Authentication Rollout Plan (Review Only)

This plan does not authorize a merge, Kubernetes modification, or deployment.
Backend PR #7 was merged at `10ef4a16ec4395bcf781c2e43a9362b0cd8c646c` and
CI published `backend-24`; that is not deployment approval. Infrastructure PRs #50
and #51 must remain open and unchanged during Phase 3.

The configuration staging below still applies. This branch also contains breaking
reservation ownership changes: see [Reservation Ownership](reservation-ownership.md)
for the mandatory Frontend coordination and traffic cutover gate. Do not deploy this
Backend independently.

## Verified repository inputs

- Infrastructure source of truth: `Pipeline360-Infra/main`.
- Application manifest: `kubernetes/backend/deployment.yaml`.
- Deployment: `backend-deployment`, namespace `hotel-system`, five replicas.
- Existing database reference: `MONGO_URL` from ConfigMap `app-config`, key `mongo-url`.
- Argo CD source: `argocd/backend-app.yaml`, path `kubernetes/backend`, revision `main`.
- Existing Ingress source: `kubernetes/platform/hotel-ingress.yaml`, host `hotel.local`,
  `/api` routes directly to `backend-service:3000`.
- Frontend NGINX can also proxy `/api` on alternative access paths. Its forwarded
  headers are not a substitute for inspecting the actual Ingress controller setup.

Repository declarations are not proof of the live cluster's state. Ingress controller
configuration, source IP preservation, TLS, live replica-set health, and network
restrictions were not inspected or changed in this review.

## 1. Establish the environment and database before preparing manifests

1. Confirm whether the existing namespace/database is local demonstration or a real
   production environment. The existing `app-config` environment label alone is not
   authoritative for the new authentication configuration.
2. Verify a backup and restore rehearsal. Preserve the existing database name and
   reservation/hotel data; do not silently redirect `MONGO_URL` to an empty database.
3. Confirm replica-set primary discovery, majority write availability, authentication,
   least-privilege credentials, and permission to create collections/indexes. Use
   separate Demo/Production hostnames, databases, and credentials when those environments are
   introduced, with an explicit data/seed plan rather than an implicit URI change.
4. Inspect existing `users`, `sessions`, and `authratelimits` collections, if present.
   Check duplicate normalized emails and incompatible unique/TTL indexes before
   rollout. The application never repairs duplicate data or drops indexes itself.

## 2. Determine configuration values without guessing proxy networks

For the existing HTTP-only local access path, the proposed nonsecret values are:

```text
AUTH_ENV=local
AUTH_ORIGIN=http://hotel.local:3000
```

This is development-only. Verify the actual browser URL first; another hostname or
port requires its own exact origin. Do not set `NODE_ENV=production` with this local
mode. For a hosted demo, use `AUTH_ENV=demo`; for production, use
`AUTH_ENV=production`. Both require the actual HTTPS browser origin, without a trailing
slash. Demo and Production must use different hostnames, not merely different ports
or paths: host-only cookies are not isolated by port. Do not invent a production hostname or enable hosted demo on insecure HTTP.

Determine `AUTH_TRUSTED_PROXIES` only after observing the Backend's TCP peer and all
supported request paths (Ingress, optional Frontend proxy, internal access). Use
specific controlled proxy IPs or narrowly scoped CIDRs. Verify that the last trusted
proxy removes/replaces untrusted forwarding headers, and that a client cannot bypass
it through the Backend Service. Broad Pod/Node CIDRs are not safe merely because
they are internal. Do not use `true`, hop-count trust, `0.0.0.0/0`, or `::/0`.

Leaving proxy trust unset is fail-closed against spoofed headers, but all users behind
one proxy then share the proxy's IP budget. That is not an acceptable production
capacity configuration. Test changing a forged leftmost X-Forwarded-For entry while
keeping the real client fixed: it must not reset the limit. Test two genuine clients:
they should have independent budgets. IPv6 clients within one /64 intentionally
share a budget, as do users behind one IPv4 NAT.

## 3. Prepare configuration separately from the application image

After separate approval, prepare two configuration-only Infrastructure PRs from
current `main`, in this order:

- PR A: add nonsecret keys to `kubernetes/platform/app-config.yaml`. Proposed new
  keys are `auth-env` for `AUTH_ENV`, `auth-origin` for `AUTH_ORIGIN`, and optionally
  `auth-trusted-proxies` for the verified `AUTH_TRUSTED_PROXIES`. These keys do not
  exist today; their values require environment review.
- PR B: after PR A has synchronized, add corresponding `configMapKeyRef` entries to
  `kubernetes/backend/deployment.yaml`, alongside the existing `MONGO_URL` reference.
- Preserve five replicas, resource requests/limits, Service names/ports, probes,
  database URI, and the current image tag in this configuration-only stage.
- If database credentials are required, provision them through the established
  Kubernetes Secrets procedure before adding reviewed `secretKeyRef` references.
  Never place a credential-bearing URI in a ConfigMap or commit real Secret values.
- Do not combine this change with PR #50 or an unrelated image update.

Because `app-config` is managed by the platform Argo CD Application and the Deployment
by the backend Application, order is important: merge/synchronize the ConfigMap change
first and verify the keys exist, then merge/synchronize Deployment env references.
Do not depend on ordering across the two Argo CD Applications. The old Backend ignores
these new auth settings, allowing configuration to be staged before the new image.
ConfigMap changes do not refresh environment variables in already-running containers;
the Deployment template change supplies the required rollout.

Every Infrastructure merge and release remains subject to explicit approval. This
review performs none of these operations.

## 4. Validate and release the authentication image through GitOps

1. Approve the intended Backend release only after final head CI succeeds. PR #7
   is already merged; the later ownership release requires its own approval.
2. Verify Backend CI and image publishing for the resulting merge commit. Record the
   actual image tag/digest and source commit; do not assume a workflow run number.
3. Review the newly generated Infrastructure image PR and confirm it references that
   source. If automation created it before configuration staging is complete, leave
   it unmerged until the configuration prerequisites are verified.
4. After explicit release approval, merge only that reviewed image PR. Let Argo CD
   perform synchronization; do not run a direct Kubernetes image update or deploy.
5. Do not expose new authentication clients until all five replicas run the new image
   and are ready. During a mixed rollout, old replicas do not implement `/api/auth`.

## 5. Acceptance checks in the approved target environment

- Argo CD has the expected Infra revision and all five Backend replicas are updated
  and ready. Inspect `/health` and `/ready` without exposing configuration values.
- Register a disposable test account; verify `free`, browser cookie flags, no session
  identifier/hash in JSON, login rotation, and `/me` through each replica.
- Verify logout with a valid CSRF proof; replaying the old cookie must fail through
  every replica. Missing/foreign Origin and missing/wrong CSRF proof must be blocked.
- Verify shared account/IP limits, spoofed forwarded headers, independent real-client
  budgets, IPv6 /64 behavior, and `Retry-After`.
- In an isolated rehearsal environment, interrupt DB connectivity and restore it:
  liveness must remain available, readiness/auth must fail closed, and recovery must
  require successful index revalidation. Rehearse initial connection/index failure.
- Test actual replica-set failover/quorum loss and ambiguous write acknowledgements;
  standalone integration tests do not prove these properties in the live topology.
- Confirm public hotel browsing and authenticated owner-scoped reservation flows
  work with the coordinated Frontend. No Premium UI is implied. Measure CPU/memory and the rate of hashing-saturation `503` responses.

## 6. Abort and rollback

If new Pods remain unready, stop release progression and leave the healthy prior
replicas serving existing functionality. Diagnose sanitized DB errors, connectivity,
credentials, index conflicts, and resource pressure without disabling readiness,
removing unique indexes, weakening write concern, or accepting insecure cookies.

Use only an explicitly approved Infrastructure revert PR to a verified compatible
image/configuration. Do not automatically revert manifests, manually deploy, remove
auth collections, or restore a database over newer writes. If auth must be suspended,
block its exposure through a separately approved operational change and preserve
account/session data for investigation. A `503` on a write does not prove that the
write was rolled back; do not blindly replay registration or claim logout succeeded.
