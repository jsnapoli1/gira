# Stage 1: Build React frontend
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.24-alpine AS backend
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY internal/ internal/
COPY cmd/ cmd/
COPY --from=frontend /app/frontend/dist frontend/dist
ARG GIT_SHA=unknown
RUN CGO_ENABLED=1 go build -ldflags="-X main.version=${GIT_SHA}" -o zira ./cmd/zira

# Stage 3: Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates sqlite su-exec
WORKDIR /app

# Add non-root user
RUN adduser -D -u 1001 appuser

# Create directories for persistent data
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

# Copy binary and static assets
COPY --from=backend /app/zira .
COPY --from=backend /app/frontend/dist frontend/dist/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Expose port
EXPOSE 9002

# Set data paths to persistent volume
ENV PORT=9002
ENV DB_PATH=/app/data/zira.db
ENV DATA_DIR=/app/data

# Run as root to handle volume permission issues, then exec as the binary
# The volume may be owned by root from Docker; chown at startup
ENTRYPOINT ["sh", "-c", "chown -R appuser:appuser /app/data 2>/dev/null; exec su-exec appuser ./zira"]
