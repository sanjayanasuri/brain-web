.PHONY: doctor help test test-frontend test-backend test-e2e

help:
	@echo "Available commands:"
	@echo "  make doctor         - Run health check for all services"
	@echo "  make test           - Run all tests (frontend + backend)"
	@echo "  make test-frontend  - Run frontend unit tests (Jest)"
	@echo "  make test-backend   - Run backend tests (pytest)"
	@echo "  make test-e2e       - Run frontend E2E tests (Playwright)"

doctor:
	@python scripts/doctor.py

test:
	@bash scripts/run-tests.sh

test-frontend:
	@cd frontend && npm test

test-backend:
	@cd backend && python -m pytest tests/test_contextual_branches*.py -v

test-e2e:
	@cd frontend && npm run test:e2e

