# syntax=docker/dockerfile:1

# ---- builder ----
# Version matches the toolchain pinned in go.mod, so a container build
# compiles with the same Go version as local `go build`.
FROM golang:1.26 AS builder
WORKDIR /src/apps/api

# Copy dependency manifests first so `go mod download` is cached across
# builds where only application source changed, not go.mod/go.sum.
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/ ./

# CGO_ENABLED=0: every dependency here (pgx, the Firebase Admin SDK) is
# pure Go, so a fully static binary works and the runtime stage below never
# needs glibc. GOOS=linux: pin the target OS explicitly regardless of the
# host building the image (e.g. macOS).
#
# One immutable image carries all three entrypoints
# (docs/deployment-architecture-v0.2.md §9 "Repository structure"): the
# Cloud Run service and the migrate/bootstrap Cloud Run Jobs select among
# them by command, rather than each being built and published separately.
# This is also what makes "the API service and the migration job that ran
# against this database were deployed from the same image digest" (§11)
# possible to assert.
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/bootstrap ./cmd/bootstrap

# ---- runtime ----
# distroless/static: no shell, no package manager, nothing beyond what a
# statically-linked Go binary needs to run. Cloud Run only needs the
# process listening on $PORT; there is no reason to ship a shell an
# attacker could use if the process were ever compromised.
FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/api /api
COPY --from=builder /out/migrate /migrate
COPY --from=builder /out/bootstrap /bootstrap

# Cloud Run injects PORT and reaches the container on it regardless of
# EXPOSE; this line is documentation for anyone running the image directly.
EXPOSE 8080

# The Cloud Run service does not override the container command, so the
# default entrypoint stays the api binary. The migrate and bootstrap Cloud
# Run Jobs override the container command to /migrate or /bootstrap
# respectively when they are configured, rather than this image having a
# separate build per entrypoint.
ENTRYPOINT ["/api"]
