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
RUN apk add --no-cache ca-certificates sqlite
WORKDIR /app

# Add non-root user
RUN adduser -D -u 1001 appuser

# Create directories for persistent data
RUN mkdir -p /app/data && chown appuser:appuser /app/data

# Copy binary and static assets
COPY --from=backend /app/zira .
COPY --from=backend /app/frontend/dist frontend/dist/

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 9002

# Set data paths to persistent volume
ENV PORT=9002
ENV DB_PATH=/app/data/zira.db
ENV DATA_DIR=/app/data
CMD ["./zira"]
