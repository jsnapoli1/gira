.PHONY: build dev frontend backend clean install

build: frontend-build backend-build

dev:
	@echo "Starting development servers..."
	@echo "Backend: http://localhost:8080"
	@echo "Frontend: http://localhost:3000"

frontend-build:
	cd frontend && npm run build

frontend-dev:
	cd frontend && npm run dev

backend-build:
	go build -o zira ./cmd/zira

backend-dev:
	go run cmd/zira/main.go

install:
	cd frontend && npm install
	go mod tidy

clean:
	rm -f zira
	rm -rf frontend/dist
	rm -rf frontend/node_modules

test:
	go test ./...
